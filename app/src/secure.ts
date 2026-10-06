// End-to-end encryption between a client and the device, over the LAN or through the relay.
// The app carries an identical copy at app/src/secure.ts; a server test fails if they differ.
//
// A connection opens with each side sending a `hello` frame holding a fresh random nonce. Both
// then derive a pair of keys from the shared secret and the two nonces, and everything after is
// `data` frames sealed with ChaCha20-Poly1305 under a per-direction message counter. A frame that
// is forged, replayed, reordered or from an earlier connection fails to open.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, bytesToUtf8, concatBytes, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** What travels on the wire, as JSON. Byte strings are hex. */
export type Frame = { t: 'hello'; n: string } | { t: 'data'; b: string };

export const NONCE_BYTES = 16;

const derive = (key: Uint8Array, salt: Uint8Array | undefined, info: string, length: number) =>
  hkdf(sha256, key, salt, utf8ToBytes(info), length);

/**
 * Everything derived from the shared token. The relay is shown `deviceId` and `relayKey`, from
 * which the token and `psk` cannot be recovered; `psk` never leaves the two ends.
 *
 * ponytail: the token is the only secret until M2 pairing gives each client its own key.
 */
export function keysFromToken(token: string) {
  const secret = utf8ToBytes(token);
  return {
    deviceId: bytesToHex(derive(secret, undefined, 'toto relay id', 16)),
    relayKey: bytesToHex(derive(secret, undefined, 'toto relay key', 32)),
    psk: derive(secret, undefined, 'toto e2e psk', 32),
  };
}

function channel(key: Uint8Array) {
  let count = 0;
  return () => {
    if (count >= 0xffffffff) throw new Error('session exhausted');
    const nonce = new Uint8Array(12);
    new DataView(nonce.buffer).setUint32(8, count++);
    return chacha20poly1305(key, nonce);
  };
}

/** The two ends of one connection, after both hellos. `seal` and `open` must each be called in wire order. */
export function session(psk: Uint8Array, role: 'client' | 'device', clientNonce: string, deviceNonce: string) {
  const salt = concatBytes(hexToBytes(clientNonce), hexToBytes(deviceNonce));
  if (salt.length !== 2 * NONCE_BYTES) throw new Error('bad hello');
  const keys = derive(psk, salt, 'toto e2e session', 64);
  const fromClient = channel(keys.subarray(0, 32));
  const fromDevice = channel(keys.subarray(32));
  const [out, incoming] = role === 'client' ? [fromClient, fromDevice] : [fromDevice, fromClient];
  return {
    seal: (text: string) => bytesToHex(out().encrypt(utf8ToBytes(text))),
    /** Throws if the frame is not the next one the other end sealed. */
    open: (sealed: string) => bytesToUtf8(incoming().decrypt(hexToBytes(sealed))),
  };
}
