import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkToken, describe, installed, startPluginLogin } from './plugins.ts';

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
  await assert.rejects(startPluginLogin({ ...login, run: ['sh', '-c', 'echo nothing useful'] }, 'test2', () => {}), /did not show a code/);
});

const paste = { env: 'Y_TOKEN', paste: { url: 'https://example.test/tokens', help: 'Make one.', pattern: '^[a-z0-9]{12}$', check: ['sh', '-c', '[ "$Y_TOKEN" = goodtoken123 ]'] } };

test('a pasted token must have the right shape and, where the plugin can tell, work', async () => {
  assert.equal(await checkToken(paste, ' goodtoken123\n'), 'goodtoken123');
  await assert.rejects(checkToken(paste, 'goodtoken124'), /not accepted/);
  for (const bad of ['', 'short', 'x'.repeat(600), 'goodtoken123 && reboot', 5, undefined]) await assert.rejects(checkToken(paste, bad), /does not look like/, String(bad));
  await assert.rejects(checkToken({ env: 'Y_TOKEN' }, 'goodtoken123'), /does not look like/);
  // With nothing to check it against, the shape is all there is.
  assert.equal(await checkToken({ ...paste, paste: { ...paste.paste, check: undefined } }, 'anything1234'), 'anything1234');
});

test('a plugin that is signed in to by pasting says where, and is told apart from one that shows a code', () => {
  const have = [{ name: 'wrangler', version: '1.0.0', description: 'W', login: paste }];
  assert.deepEqual(describe(have, [], {}), [{ name: 'wrangler', description: 'W', version: '1.0.0', login: true, paste: { url: 'https://example.test/tokens', help: 'Make one.' } }]);
});
