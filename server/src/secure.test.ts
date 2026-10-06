import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { keysFromToken, session } from './secure.ts';

const cn = 'aa'.repeat(16);
const dn = 'bb'.repeat(16);
const { psk } = keysFromToken('token');

test('a session carries messages both ways', () => {
  const client = session(psk, 'client', cn, dn);
  const device = session(psk, 'device', cn, dn);
  assert.equal(device.open(client.seal('héllo')), 'héllo');
  assert.equal(device.open(client.seal('again')), 'again');
  assert.equal(client.open(device.seal('reply')), 'reply');
});

test('rejects replayed, reordered, tampered and foreign frames', () => {
  const client = session(psk, 'client', cn, dn);
  const device = session(psk, 'device', cn, dn);
  const first = client.seal('one');
  const second = client.seal('two');
  assert.throws(() => device.open(second), 'out of order');
  // That failed attempt used up the device's place in the sequence, so the connection is dead: by design.

  const fresh = () => [session(psk, 'client', cn, dn), session(psk, 'device', cn, dn)] as const;
  let [c, d] = fresh();
  const frame = c.seal('one');
  d.open(frame);
  assert.throws(() => d.open(frame), 'replay');

  [c, d] = fresh();
  const flipped = c.seal('one').replace(/^./, (h) => (h === '0' ? '1' : '0'));
  assert.throws(() => d.open(flipped), 'tampered');

  // The client's own frame reflected back at it.
  [c, d] = fresh();
  assert.throws(() => c.open(c.seal('one')), 'reflected');

  // Same token, another connection's nonces.
  assert.throws(() => session(psk, 'device', cn, 'cc'.repeat(16)).open(first), 'other session');
  assert.throws(() => session(keysFromToken('other').psk, 'device', cn, dn).open(first), 'other token');
  assert.throws(() => session(psk, 'device', cn, 'bb'), 'short nonce');
});

test('what the relay sees does not reveal the token or each other', () => {
  const k = keysFromToken('token');
  assert.equal(k.deviceId.length, 32);
  assert.equal(k.relayKey.length, 64);
  assert.notEqual(k.relayKey, Buffer.from(k.psk).toString('hex'));
  assert.notEqual(keysFromToken('token2').deviceId, k.deviceId);
});

test("the app's copy of secure.ts is identical", () => {
  const app = new URL('../../app/src/secure.ts', import.meta.url);
  if (!existsSync(app)) return; // an installed server has no app beside it
  assert.equal(readFileSync(app, 'utf8'), readFileSync(new URL('./secure.ts', import.meta.url), 'utf8'));
});
