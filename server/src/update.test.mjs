import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { newer, signedBy } from '../../bin/toto-update.mjs';

test('an update must be newer, compared as numbers', () => {
  assert.ok(newer('0.10.0', '0.9.9') && newer('1.0.0', '0.99.99') && newer('0.1.1', '0.1.0'));
  assert.ok(!newer('0.1.0', '0.1.0') && !newer('0.1.0', '0.2.0'));
  // Anything that is not three plain numbers is never an update.
  assert.ok(!newer('9.9.9; rm -rf /', '0.1.0') && !newer('2', '0.1.0') && !newer(undefined, '0.1.0'));
});

test('an update must be signed by the release key, over exactly these bytes', () => {
  const pem = (k) => k.export({ type: 'spki', format: 'pem' });
  const ours = generateKeyPairSync('ed25519');
  const theirs = generateKeyPairSync('ed25519');
  const bundle = Buffer.from('a release');
  const signature = sign(null, bundle, ours.privateKey);
  assert.ok(signedBy(pem(ours.publicKey), bundle, signature));
  assert.ok(!signedBy(pem(ours.publicKey), Buffer.from('a release, altered'), signature));
  assert.ok(!signedBy(pem(theirs.publicKey), bundle, signature));
  assert.ok(!signedBy(pem(ours.publicKey), bundle, Buffer.alloc(64)) && !signedBy('not a key', bundle, signature));
});

test('the release key in the repository is one the updater can read', () => {
  assert.ok(!signedBy(readFileSync(new URL('../../release.pub', import.meta.url)), Buffer.from('x'), Buffer.alloc(64)));
  assert.match(readFileSync(new URL('../../release.pub', import.meta.url), 'utf8'), /BEGIN PUBLIC KEY/);
});
