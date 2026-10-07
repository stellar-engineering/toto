// Setting a device up over Bluetooth. Before a Toto is on the network there is no other way to
// reach it, so it offers a small Bluetooth LE service that a phone nearby can find: read what
// the device is, agree a key, then send it Wi-Fi details and collect the keys to it.
//
// The service is three characteristics:
//   info   read    who this device is, in the clear (it is no secret)
//   rx     write   frames from the phone
//   tx     notify  frames to the phone
// Frames are the same JSON as on the network (see secure.ts), one per line, cut into pieces
// small enough for a Bluetooth packet.
import { randomBytes } from 'node:crypto';
import dbus from 'dbus-next';
import type { SetupInfo, SetupReply, SetupRequest } from '../../protocol.ts';
import { type Frame, NONCE_BYTES, publicKey, session, setupKey } from './secure.ts';

export const SERVICE = '7070a000-70ad-4b1e-8f4c-746f746f0001';
const RX = '7070a001-70ad-4b1e-8f4c-746f746f0001';
const TX = '7070a002-70ad-4b1e-8f4c-746f746f0001';
const INFO = '7070a003-70ad-4b1e-8f4c-746f746f0001';
const ROOT = '/dev/stellar/toto';
const ADAPTER = '/org/bluez/hci0';

const { Interface } = dbus.interface;
const { Variant } = dbus;
const v = (signature: string, value: unknown) => new Variant(signature, value);
const CHARACTERISTIC = {
  properties: { UUID: { signature: 's', access: 'read' }, Service: { signature: 'o', access: 'read' }, Flags: { signature: 'as', access: 'read' } },
} as const;

type Options = {
  /** What to tell anyone who asks, before any key is exchanged. */
  info: () => SetupInfo;
  /** The secret this device shares with its owner. Mixed into the key once it has one. */
  psk: Uint8Array;
  /** Carries out a request that arrived over an established, encrypted conversation. */
  handle: (request: SetupRequest) => Promise<SetupReply>;
};

/**
 * Starts offering the setup service. Resolves to whether it is being advertised; a machine with
 * no Bluetooth is not an error, it just cannot be set up this way.
 */
export async function startBluetooth({ info, psk, handle }: Options): Promise<boolean> {
  let bus: dbus.MessageBus;
  try {
    bus = dbus.systemBus();
    bus.on('error', () => {});
  } catch {
    return false;
  }

  // One conversation per phone. A phone that starts again simply replaces its old one.
  type Talk = { partial: string; mtu: number; secure?: ReturnType<typeof session> };
  const talks = new Map<string, Talk>();

  class Service extends Interface {
    get UUID() { return SERVICE; }
    get Primary() { return true; }
  }
  Service.configureMembers({ properties: { UUID: { signature: 's', access: 'read' }, Primary: { signature: 'b', access: 'read' } } });

  class Tx extends Interface {
    private value: Buffer = Buffer.alloc(0);
    get UUID() { return TX; }
    get Service() { return `${ROOT}/s0`; }
    get Flags() { return ['notify']; }
    get Value() { return this.value; }
    StartNotify() {}
    StopNotify() {}
    notify(piece: Buffer) {
      this.value = piece;
      Interface.emitPropertiesChanged(this, { Value: piece }, []);
    }
  }
  Tx.configureMembers({
    properties: { ...CHARACTERISTIC.properties, Value: { signature: 'ay', access: 'read' } },
    methods: { StartNotify: { inSignature: '', outSignature: '' }, StopNotify: { inSignature: '', outSignature: '' } },
  });
  const tx = new Tx('org.bluez.GattCharacteristic1');

  // Pieces go out one at a time and in order; two frames interleaved would be unreadable.
  let sending = Promise.resolve();
  const send = (talk: Talk, frame: Frame) => {
    const bytes = Buffer.from(JSON.stringify(frame) + '\n');
    // A notification can carry three bytes less than the connection's packet size.
    const size = Math.max(20, Math.min(talk.mtu - 3, 180));
    sending = sending.then(async () => {
      for (let at = 0; at < bytes.length; at += size) {
        tx.notify(bytes.subarray(at, at + size));
        await new Promise((next) => setTimeout(next, 8));
      }
    });
  };

  const receive = async (peer: string, talk: Talk, line: string) => {
    try {
      const frame: Frame = JSON.parse(line);
      if (frame.t === 'hello') {
        if (!frame.k) throw new Error('hello without a key');
        const secret = randomBytes(32);
        const nonce = randomBytes(NONCE_BYTES).toString('hex');
        // Once this device has an owner, its token is part of the key: a stranger completes the
        // exchange but can open nothing, and gets silence.
        const key = setupKey(secret, frame.k, info().claimed ? psk : undefined);
        talk.secure = session(key, 'device', frame.n, nonce);
        return send(talk, { t: 'hello', n: nonce, k: publicKey(secret) });
      }
      if (!talk.secure) throw new Error('data before hello');
      const request: SetupRequest = JSON.parse(talk.secure.open(frame.b));
      const reply = await handle(request).catch((err): SetupReply => ({ type: 'refused', problem: String(err.message ?? err) }));
      send(talk, { t: 'data', b: talk.secure.seal(JSON.stringify(reply)) });
    } catch {
      talks.delete(peer); // a conversation cannot recover from a frame that does not open
    }
  };

  class Rx extends Interface {
    get UUID() { return RX; }
    get Service() { return `${ROOT}/s0`; }
    get Flags() { return ['write', 'write-without-response']; }
    WriteValue(value: Buffer, options: Record<string, dbus.Variant>) {
      const peer = String(options.device?.value ?? 'unknown');
      let talk = talks.get(peer);
      if (!talk) {
        if (talks.size >= 4) talks.delete(talks.keys().next().value!);
        talks.set(peer, (talk = { partial: '', mtu: 23 }));
      }
      if (typeof options.mtu?.value === 'number') talk.mtu = options.mtu.value;
      const lines = (talk.partial + Buffer.from(value).toString()).split('\n');
      talk.partial = lines.pop()!.slice(-8192); // never hold more than one sane frame's worth
      for (const line of lines) if (line) void receive(peer, talk, line);
    }
  }
  Rx.configureMembers({ ...CHARACTERISTIC, methods: { WriteValue: { inSignature: 'aya{sv}', outSignature: '' } } });

  class Info extends Interface {
    get UUID() { return INFO; }
    get Service() { return `${ROOT}/s0`; }
    get Flags() { return ['read']; }
    ReadValue(options: Record<string, dbus.Variant>) {
      // Longer than one packet, so the phone reads it in parts, each from where the last ended.
      return Buffer.from(JSON.stringify(info())).subarray(Number(options.offset?.value ?? 0));
    }
  }
  Info.configureMembers({ ...CHARACTERISTIC, methods: { ReadValue: { inSignature: 'a{sv}', outSignature: 'ay' } } });

  // BlueZ learns what we offer by asking the root for everything beneath it.
  class Manager extends Interface {
    GetManagedObjects() {
      const characteristic = (uuid: string, flags: string[]) => ({
        'org.bluez.GattCharacteristic1': { UUID: v('s', uuid), Service: v('o', `${ROOT}/s0`), Flags: v('as', flags) },
      });
      return {
        [`${ROOT}/s0`]: { 'org.bluez.GattService1': { UUID: v('s', SERVICE), Primary: v('b', true) } },
        [`${ROOT}/s0/info`]: characteristic(INFO, ['read']),
        [`${ROOT}/s0/rx`]: characteristic(RX, ['write', 'write-without-response']),
        [`${ROOT}/s0/tx`]: characteristic(TX, ['notify']),
      };
    }
  }
  Manager.configureMembers({ methods: { GetManagedObjects: { inSignature: '', outSignature: 'a{oa{sa{sv}}}' } } });

  class Advert extends Interface {
    get Type() { return 'peripheral'; }
    get ServiceUUIDs() { return [SERVICE]; }
    // Short on purpose: the long service id leaves room in the advertisement for little else.
    get LocalName() { return 'Toto'; }
    Release() {}
  }
  Advert.configureMembers({
    properties: { Type: { signature: 's', access: 'read' }, ServiceUUIDs: { signature: 'as', access: 'read' }, LocalName: { signature: 's', access: 'read' } },
    methods: { Release: { inSignature: '', outSignature: '' } },
  });

  try {
    bus.export(ROOT, new Manager('org.freedesktop.DBus.ObjectManager'));
    bus.export(`${ROOT}/s0`, new Service('org.bluez.GattService1'));
    bus.export(`${ROOT}/s0/info`, new Info('org.bluez.GattCharacteristic1'));
    bus.export(`${ROOT}/s0/rx`, new Rx('org.bluez.GattCharacteristic1'));
    bus.export(`${ROOT}/s0/tx`, tx);
    bus.export(`${ROOT}/adv`, new Advert('org.bluez.LEAdvertisement1'));
    const bluez = await bus.getProxyObject('org.bluez', ADAPTER);
    await bluez.getInterface('org.freedesktop.DBus.Properties').Set('org.bluez.Adapter1', 'Powered', v('b', true));
    await bluez.getInterface('org.bluez.GattManager1').RegisterApplication(ROOT, {});
    await bluez.getInterface('org.bluez.LEAdvertisingManager1').RegisterAdvertisement(`${ROOT}/adv`, {});
    return true;
  } catch (err) {
    // No adapter, Bluetooth switched off, or no BlueZ at all.
    console.log(`bluetooth setup unavailable: ${(err as Error).message}`);
    bus.disconnect();
    return false;
  }
}
