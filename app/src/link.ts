// Getting an encrypted line to a Toto: the local network first, since it is faster and works with
// no internet, then the relay. Knows nothing about what is said over the line.
import { bytesToHex } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import type { ClientMessage, ServerMessage } from '../../protocol';
import { type Frame, NONCE_BYTES, keysFromToken, session } from './secure';

export type Route = 'local' | 'relay';
/** Where a Toto is and the secret shared with it. `relay` may be empty, meaning local network only. */
export type Settings = { address: string; token: string; relay: string };
export type Link = { via: Route; send: (message: ClientMessage) => void; close: () => void };
/** Why no line could be had: the relay says the device is not connected to it, or nothing answered at all. */
export type Unreachable = 'offline' | 'silent';

// How long to wait to hear from the device. The local network answers in a blink or not at all,
// so it gets little; the relay is given longer, for slow mobile connections.
const LOCAL_TIMEOUT = 2_500;
const RELAY_TIMEOUT = 10_000;
const DEVICE_OFFLINE = 4404; // the relay's close code for "that device is not connected"

/** The id a device is known by at the relay, and by this app. */
export const deviceIdOf = (token: string) => keysFromToken(token.trim()).deviceId;

type Handlers = {
  /** Sent as soon as the line is secure. The device says nothing until it has heard this. */
  first: ClientMessage;
  onMessage: (message: ServerMessage, link: Link) => void;
  /** The line was up and has gone. Not called for a line we closed or cancelled ourselves. */
  onLost?: () => void;
  /** A route is about to be tried, so whoever is waiting can be told which. */
  onTry?: (via: Route) => void;
};

function attempt(url: string, psk: Uint8Array, via: Route, handlers: Handlers, done: (result: Link | Unreachable) => void) {
  handlers.onTry?.(via);
  const ws = new WebSocket(url);
  const nonce = bytesToHex(getRandomValues(new Uint8Array(NONCE_BYTES)));
  let secure: ReturnType<typeof session> | undefined;
  let state: 'trying' | 'live' | 'over' = 'trying';
  const link: Link = {
    via,
    send: (message) => {
      if (ws.readyState === WebSocket.OPEN && secure) ws.send(JSON.stringify({ t: 'data', b: secure.seal(JSON.stringify(message)) } satisfies Frame));
    },
    close: () => {
      state = 'over';
      ws.close();
    },
  };
  const fail = (why: Unreachable) => {
    if (state !== 'trying') return;
    state = 'over';
    clearTimeout(giveUp);
    ws.close();
    done(why);
  };
  // The limit is ours to enforce. Left to the system, an address that does not answer can hold
  // a connection attempt open for over a minute before reporting it closed.
  const giveUp = setTimeout(() => fail('silent'), via === 'local' ? LOCAL_TIMEOUT : RELAY_TIMEOUT);

  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', n: nonce } satisfies Frame));
  ws.onmessage = (m) => {
    if (state === 'over') return ws.close();
    try {
      const frame: Frame = JSON.parse(m.data);
      if (frame.t === 'hello' && !secure) {
        secure = session(psk, 'client', nonce, frame.n);
        return link.send(handlers.first);
      }
      if (frame.t !== 'data' || !secure) throw new Error('unexpected frame');
      const message: ServerMessage = JSON.parse(secure.open(frame.b));
      if (state === 'trying') {
        // A frame that opens proves the other end is our device, not just something at that address.
        state = 'live';
        clearTimeout(giveUp);
        done(link);
      }
      handlers.onMessage(message, link);
    } catch {
      ws.close();
    }
  };
  ws.onclose = (e) => {
    if (state === 'trying') return fail(e.code === DEVICE_OFFLINE ? 'offline' : 'silent');
    if (state === 'live') {
      state = 'over';
      handlers.onLost?.();
    }
  };
  return () => link.close();
}

/**
 * Opens a line to the Toto described by `to`. `done` is called once, with the line or with why
 * there is none. Returns a function that abandons the attempt, or the line if it is up.
 */
export function reach(to: Settings, handlers: Handlers, done: (result: Link | Unreachable) => void): () => void {
  const { psk, deviceId, relayKey } = keysFromToken(to.token.trim());
  let cancel = attempt(to.address.trim(), psk, 'local', handlers, (local) => {
    if (typeof local !== 'string') return done(local);
    const relay = to.relay.trim().replace(/\/$/, '');
    if (!relay) return done('silent');
    cancel = attempt(`${relay}/v1/${deviceId}?role=client&k=${relayKey}`, psk, 'relay', handlers, done);
  });
  return () => cancel();
}

/** Asks a Toto whether it is there. Resolves to how it was reached and its name, or to why not. */
export const ping = (to: Settings) =>
  new Promise<{ via: Route; name: string } | Unreachable>((resolve) => {
    // In case a device takes the line and then never answers.
    setTimeout(() => resolve('silent'), 20_000);
    reach(
      to,
      {
        first: { type: 'ping' },
        onMessage: (message, link) => {
          if (message.type !== 'pong') return;
          resolve({ via: link.via, name: message.name });
          link.close();
        },
      },
      (result) => typeof result === 'string' && resolve(result),
    );
  });
