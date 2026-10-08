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

test('Bluetooth setup: two ends agree on a key nobody listening can work out', async () => {
  const { publicKey, setupKey } = await import('./secure.ts');
  const phone = new Uint8Array(32).fill(1);
  const device = new Uint8Array(32).fill(2);
  const stranger = new Uint8Array(32).fill(3);
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

  const fromPhone = setupKey(phone, publicKey(device));
  assert.equal(hex(fromPhone), hex(setupKey(device, publicKey(phone))));
  assert.notEqual(hex(fromPhone), hex(setupKey(stranger, publicKey(device))));

  // A device with an owner mixes in its token, so the right key exchange alone is not enough.
  const owned = setupKey(device, publicKey(phone), psk);
  assert.equal(hex(owned), hex(setupKey(phone, publicKey(device), psk)));
  assert.notEqual(hex(owned), hex(fromPhone));
  assert.notEqual(hex(owned), hex(setupKey(phone, publicKey(device), keysFromToken('wrong').psk)));

  // And the key drives an ordinary session.
  const a = session(owned, 'client', cn, dn);
  const b = session(owned, 'device', cn, dn);
  assert.equal(b.open(a.seal('wifi password')), 'wifi password');
});

test('a sealed handoff opens only for the key it was sealed to, and only whole', async () => {
  const { randomBytes } = await import('node:crypto');
  const { openSealed, publicKey, sealTo } = await import('./secure.ts');
  const random = (n: number) => new Uint8Array(randomBytes(n));
  const mine = random(32);
  const sealed = sealTo(publicKey(mine), 'an invitation', random);
  assert.equal(openSealed(mine, sealed), 'an invitation');
  assert.ok(!JSON.stringify(sealed).includes('invitation'));
  // Sealed twice, it looks different each time: nothing is reused.
  assert.notDeepEqual(sealTo(publicKey(mine), 'an invitation', random), sealed);
  assert.throws(() => openSealed(random(32), sealed));
  assert.throws(() => openSealed(mine, { ...sealed, b: sealed.b.replace(/.$/, (c) => (c === '0' ? '1' : '0')) }));
  assert.throws(() => openSealed(mine, { ...sealed, k: publicKey(random(32)) }));
});
