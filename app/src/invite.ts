// An invitation to share a Toto, as it travels between two phones. No React in here, so the
// server's tests can check it: it is read from a camera pointed at who knows what.
import type { ServerMessage } from '../../protocol';

/** An invitation for another phone, as the device hands it to the owner's. */
export type Invite = Extract<ServerMessage, { type: 'invite' }>;
/** What a phone needs from an invitation to join: everything in it but when it runs out. */
export type Invitation = Pick<Invite, 'phoneId' | 'secret' | 'deviceId' | 'relayKey' | 'address' | 'relay' | 'name'>;

// An invitation travels as a link, toto://join?…, inside a QR code. Scanned with the phone's
// own camera, it opens the app here.
const FIELDS = { a: 'address', r: 'relay', d: 'deviceId', k: 'relayKey', i: 'phoneId', s: 'secret', n: 'name' } as const;

export const inviteLink = (invite: Invite) =>
  'toto://join?' + Object.entries(FIELDS).map(([short, field]) => `${short}=${encodeURIComponent(invite[field])}`).join('&');

/** Reads an invitation out of a link's parameters. Undefined if it is not one, or not whole. */
export function invitationIn(params: Record<string, unknown>): Invitation | undefined {
  const found: Partial<Invitation> = {};
  for (const [short, field] of Object.entries(FIELDS) as [keyof typeof FIELDS, keyof Invitation][]) {
    const value = params[short];
    if (typeof value !== 'string' || value.length > 300) return undefined;
    found[field] = value;
  }
  const { address, relay, deviceId, relayKey, phoneId, secret, name } = found as Invitation;
  // Checked for shape, since it came from a camera pointed at who knows what. Only an address
  // that is a WebSocket is ever dialled.
  if (!/^wss?:\/\/\S+$/.test(address) || (relay && !/^wss?:\/\/\S+$/.test(relay))) return undefined;
  if (!/^[0-9a-f]{32}$/.test(deviceId) || !/^[0-9a-f]{64}$/.test(relayKey) || !/^[0-9a-f]{8}$/.test(phoneId) || !/^[0-9a-f]{32}$/.test(secret) || !name.trim()) return undefined;
  return found as Invitation;
}
