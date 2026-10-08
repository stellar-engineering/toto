import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkManifest, install, isLogin, isName } from '../../bin/toto-plugin.mjs';

const pem = (k) => k.export({ type: 'spki', format: 'pem' });
const ours = generateKeyPairSync('ed25519');
const publicKey = pem(ours.publicKey);

/** A signed bundle holding `files`, the way plugins/pack.mjs makes one. */
function bundle(files, key = ours.privateKey) {
  const src = mkdtempSync(join(tmpdir(), 'toto-bundle-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(src, name, '..'), { recursive: true });
    writeFileSync(join(src, name), text);
  }
  const tgz = execFileSync('tar', ['czf', '-', '-C', src, '.']);
  return { tgz, sig: sign(null, tgz, key) };
}
const manifest = (extra = {}) => JSON.stringify({ name: 'gh', version: '1.0.0', apt: ['gh'], ...extra });
const target = () => {
  const dir = mkdtempSync(join(tmpdir(), 'toto-plugins-'));
  const installed = [];
  return { dir, installed, deps: { publicKey, dir, apt: (p) => installed.push(...p), npm: (p) => installed.push(...p) } };
};

test('a plugin signed with the plugin key is installed, and its packages asked for', async () => {
  const { dir, installed, deps } = target();
  const { tgz, sig } = bundle({ 'manifest.json': manifest(), 'skills/gh/SKILL.md': 'use gh' });
  assert.equal(await install('gh', tgz, sig, deps), '1.0.0');
  assert.deepEqual(installed, ['gh']);
  assert.equal(readFileSync(`${dir}/gh/skills/gh/SKILL.md`, 'utf8'), 'use gh');
});

test('a plugin that is not signed by the plugin key, or was altered, installs nothing', async () => {
  const { dir, installed, deps } = target();
  const theirs = generateKeyPairSync('ed25519');
  const forged = bundle({ 'manifest.json': manifest() }, theirs.privateKey);
  await assert.rejects(install('gh', forged.tgz, forged.sig, deps), /not signed/);
  const real = bundle({ 'manifest.json': manifest() });
  await assert.rejects(install('gh', Buffer.concat([real.tgz, Buffer.from('x')]), real.sig, deps), /not signed/);
  assert.deepEqual(installed, []);
  assert.ok(!existsSync(`${dir}/gh`));
});

test('a signed bundle for a different plugin is refused, and so is an older version', async () => {
  const { installed, deps } = target();
  const other = bundle({ 'manifest.json': manifest({ name: 'other' }) });
  await assert.rejects(install('gh', other.tgz, other.sig, deps), /not the gh plugin/);
  const v2 = bundle({ 'manifest.json': manifest({ version: '2.0.0' }) });
  await install('gh', v2.tgz, v2.sig, deps);
  const v1 = bundle({ 'manifest.json': manifest() });
  await assert.rejects(install('gh', v1.tgz, v1.sig, deps), /already installed/);
  assert.deepEqual(installed, ['gh']);
});

test('names and packages that are not plain are refused', () => {
  for (const bad of ['', 'Gh', '../gh', 'gh;reboot', '-gh', 'a'.repeat(32), undefined]) assert.ok(!isName(bad), String(bad));
  for (const apt of [['-o=APT::Foo'], ['gh', 'a b'], 'gh', Array(11).fill('gh')]) assert.throws(() => checkManifest({ name: 'gh', version: '1.0.0', apt }, 'gh'), /packages/);
  assert.throws(() => checkManifest({ name: 'gh', version: '1.0' }, 'gh'), /version/);
});

test('the plugin key in the repository is one the installer can read', () => {
  assert.match(readFileSync(new URL('../../plugin.pub', import.meta.url), 'utf8'), /BEGIN PUBLIC KEY/);
  assert.notEqual(readFileSync(new URL('../../plugin.pub', import.meta.url), 'utf8'), readFileSync(new URL('../../release.pub', import.meta.url), 'utf8'));
});

test('the gh plugin in the repository is one the installer accepts, and a sign-in must name a secret', () => {
  const gh = JSON.parse(readFileSync(new URL('../../plugins/gh/manifest.json', import.meta.url), 'utf8'));
  checkManifest(gh, 'gh');
  for (const env of ['PATH', 'LD_PRELOAD', 'gh_token', 'X', undefined]) assert.ok(!isLogin({ ...gh.login, env }), String(env));
  assert.ok(!isLogin({ ...gh.login, url: '(' }) && !isLogin({ ...gh.login, run: 'gh auth login' }) && !isLogin({ ...gh.login, token: [] }));
});

test('npm packages must be one exact version, and the wrangler plugin is accepted', () => {
  const wrangler = JSON.parse(readFileSync(new URL('../../plugins/wrangler/manifest.json', import.meta.url), 'utf8'));
  checkManifest(wrangler, 'wrangler');
  for (const npm of [['wrangler'], ['wrangler@latest'], ['wrangler@^4.1.0'], ['-g@1.0.0'], ['a@1.0.0; reboot'], 'wrangler@4.0.0']) assert.throws(() => checkManifest({ ...wrangler, npm }, 'wrangler'), /packages/, String(npm));
  for (const paste of [{ ...wrangler.login.paste, url: 'http://example.test/' }, { ...wrangler.login.paste, url: 'javascript:alert(1)' }, { ...wrangler.login.paste, pattern: '(' }, { ...wrangler.login.paste, check: 'wrangler whoami' }]) assert.ok(!isLogin({ ...wrangler.login, paste }), JSON.stringify(paste));
  assert.ok(!isLogin({ ...wrangler.login, run: ['wrangler'] }));
});

test('a plugin that lists npm packages has them installed, and says where it is up to', async () => {
  const { installed, deps } = target();
  const { tgz, sig } = bundle({ 'manifest.json': manifest({ apt: undefined, npm: ['wrangler@4.149.0'] }) });
  const said = [];
  await install('gh', tgz, sig, { ...deps, steps: { next: (text) => said.push(text) } });
  assert.deepEqual(installed, ['wrangler@4.149.0']);
  assert.deepEqual(said, ['Installing packages', 'Putting it in place']);
});
