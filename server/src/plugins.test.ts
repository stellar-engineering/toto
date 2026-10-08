import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { describe, installed, startPluginLogin } from './plugins.ts';

const login = { run: ['sh', '-c', 'echo "Open https://example.test/device and enter ABCD-1234"; sleep 1; echo $HOME > "$HOME/token"'], url: 'https://example\\.test/device', code: '[A-Z0-9]{4}-[A-Z0-9]{4}', token: ['sh', '-c', 'cat "$HOME/token"'], env: 'X_TOKEN' };

test('what is installed is what is on disk, and the relay only adds what is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toto-plugins-'));
  mkdirSync(`${dir}/gh`);
  writeFileSync(`${dir}/gh/manifest.json`, JSON.stringify({ name: 'gh', version: '1.0.0', description: 'GitHub', login }));
  mkdirSync(`${dir}/lies`);
  writeFileSync(`${dir}/lies/manifest.json`, JSON.stringify({ name: 'other', version: '1.0.0' }));
  mkdirSync(`${dir}/.incoming-x`);
  const have = installed(dir);
  assert.deepEqual(have.map((m) => m.name), ['gh']);
  const offered = [{ name: 'gh', version: '1.1.0', description: 'GitHub' }, { name: 'notes', version: '0.1.0', description: 'Notes' }];
  assert.deepEqual(describe(have, offered, {}), [
    { name: 'gh', description: 'GitHub', version: '1.0.0', latest: '1.1.0', login: true },
    { name: 'notes', description: 'Notes' },
  ]);
  assert.equal(describe(have, [], { X_TOKEN: 'x' })[0].signedIn, true);
  assert.deepEqual(installed('/nowhere'), []);
});

test('a plugin sign-in shows its address and code, then hands back the token it earned', async () => {
  const done = new Promise<[string | undefined, string | undefined]>((resolve) => void startPluginLogin(login, 'test', (token, why) => resolve([token, why])).then((shown) => assert.deepEqual(shown, { url: 'https://example.test/device', code: 'ABCD-1234' })));
  const [token, why] = await done;
  assert.equal(why, undefined);
  assert.match(token!, /toto-login-/);
});

test('a sign-in that never shows a code gives up with a reason', async () => {
  await assert.rejects(startPluginLogin({ ...login, run: ['sh', '-c', 'echo nothing useful'] }, 'test2', () => {}), /did not offer a code/);
});
