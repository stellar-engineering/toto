// The phone's side of setting a Toto up over Bluetooth. See server/src/ble.ts for the other.
import { bytesToHex, bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import { PermissionsAndroid, Platform } from 'react-native';
import type { SetupInfo, SetupReply, SetupRequest } from '../../protocol';
import { type Frame, NONCE_BYTES, publicKey, session, setupKey } from './secure';

export type { SetupInfo, SetupReply, WifiNetwork } from '../../protocol';

const SERVICE = '7070a000-70ad-4b1e-8f4c-746f746f0001';
const RX = '7070a001-70ad-4b1e-8f4c-746f746f0001';
const TX = '7070a002-70ad-4b1e-8f4c-746f746f0001';
const INFO = '7070a003-70ad-4b1e-8f4c-746f746f0001';

type Manager = (typeof import('react-native-ble-manager'))['default'];
let loaded: Manager | null | undefined;
let started: Promise<void> | undefined;

// The Bluetooth code is native, so it exists in the installed app and not in Expo Go. Loaded on
// first use, so that everything else keeps working where it is missing.
function manager(): Manager | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- an import would fail the whole app where the native code is missing
      loaded = require('react-native-ble-manager').default as Manager;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** Why Bluetooth cannot be used right now, or 'ready'. Asks for permission the first time. */
export async function bluetooth(): Promise<'ready' | 'unsupported' | 'denied' | 'off'> {
  const ble = manager();
  if (!ble) return 'unsupported';
  if (Platform.OS === 'android') {
    const wanted =
      Number(Platform.Version) >= 31
        ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const answers = await PermissionsAndroid.requestMultiple(wanted);
    if (wanted.some((p) => answers[p] !== PermissionsAndroid.RESULTS.GRANTED)) return 'denied';
  }
  try {
    await (started ??= ble.start({ showAlert: false }));
    const state = await ble.checkState();
    return state === 'on' ? 'ready' : state === 'unauthorized' ? 'denied' : state === 'unsupported' ? 'unsupported' : 'off';
  } catch {
    return 'unsupported';
  }
}

export type Found = { id: string; signal: number };

/** Looks for Totos offering setup nearby. Returns a function that stops looking. */
export function look(onFound: (toto: Found) => void): () => void {
  const ble = manager();
  if (!ble) return () => {};
  const heard = ble.onDiscoverPeripheral((p) => onFound({ id: p.id, signal: p.rssi }));
  ble.scan({ serviceUUIDs: [SERVICE], seconds: 0 }).catch(() => {});
  return () => {
    heard.remove();
    ble.stopScan().catch(() => {});
  };
}

export type Setup = {
  info: SetupInfo;
  /** Sends a request over the encrypted conversation and resolves to the device's answer. */
  ask: (request: SetupRequest) => Promise<SetupReply>;
  close: () => void;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Connects to a Toto and agrees a key with it. `knownKey` is asked for when the device says it
 * already has an owner: given its id, return the secret this phone shares with it, if it is one
 * of ours. Rejects with a sentence fit to show if anything goes wrong.
 */
export async function openSetup(id: string, knownKey: (deviceId: string) => Uint8Array | undefined): Promise<Setup> {
  const ble = manager();
  if (!ble) throw new Error('Bluetooth setup needs the installed app.');
  await ble.connect(id);
  const mtu = Platform.OS === 'android' ? await ble.requestMTU(id, 247).catch(() => 23) : 185;
  await ble.retrieveServices(id, [SERVICE]);
  const info: SetupInfo = JSON.parse(bytesToUtf8(Uint8Array.from(await ble.read(id, SERVICE, INFO))));

  // Frames arrive in pieces; a newline ends each one.
  let partial = '';
  let waiting: ((frame: Frame) => void) | undefined;
  const heard = ble.onDidUpdateValueForCharacteristic((e) => {
    if (e.peripheral !== id || !same(e.characteristic, TX)) return;
    const lines = (partial + bytesToUtf8(Uint8Array.from(e.value))).split('\n');
    partial = lines.pop()!;
    for (const line of lines) {
      if (!line) continue;
      const next = waiting;
      waiting = undefined;
      try {
        next?.(JSON.parse(line));
      } catch {
        // not a frame; whoever was waiting times out
      }
    }
  });
  await ble.startNotification(id, SERVICE, TX);

  const close = () => {
    heard.remove();
    ble.disconnect(id).catch(() => {});
  };
  // One exchange at a time: write a frame, wait for the one that answers it.
  const exchange = (frame: Frame, patience: number) =>
    new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting = undefined;
        reject(new Error('It stopped answering. Move closer and try again.'));
      }, patience);
      waiting = (answer) => {
        clearTimeout(timer);
        resolve(answer);
      };
      const bytes = Array.from(utf8ToBytes(JSON.stringify(frame) + '\n'));
      ble.write(id, SERVICE, RX, bytes, Math.max(20, Math.min(mtu - 3, 180))).catch((err) => {
        clearTimeout(timer);
        waiting = undefined;
        reject(new Error(String(err)));
      });
    });

  try {
    const known = info.claimed ? knownKey(info.id) : undefined;
    if (info.claimed && !known) throw new Error(`${info.name} has already been set up by someone. If it is yours, add it with its address and token instead.`);
    const secret = getRandomValues(new Uint8Array(32));
    const nonce = bytesToHex(getRandomValues(new Uint8Array(NONCE_BYTES)));
    const hello = await exchange({ t: 'hello', n: nonce, k: publicKey(secret) }, 10_000);
    if (hello.t !== 'hello' || !hello.k) throw new Error('That device did not answer like a Toto.');
    const secure = session(setupKey(secret, hello.k, known), 'client', nonce, hello.n);
    return {
      info,
      close,
      // Joining Wi-Fi is the slow one: the device waits most of a minute for the network to answer.
      ask: async (request) => {
        const answer = await exchange({ t: 'data', b: secure.seal(JSON.stringify(request)) }, request.type === 'join' ? 75_000 : 30_000);
        if (answer.t !== 'data') throw new Error('That device did not answer like a Toto.');
        return JSON.parse(secure.open(answer.b));
      },
    };
  } catch (err) {
    close();
    throw err;
  }
}
