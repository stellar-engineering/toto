import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The root helper, run for real with stand-ins for the system tools it calls.
const priv = new URL('../../bin/toto-priv', import.meta.url).pathname;
const bin = mkdtempSync(join(tmpdir(), 'toto-priv-'));
const fake = (name, script) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, name), 0o755);
};
const run = (...args) => spawnSync('bash', [priv, ...args], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}` } });

test('listing Wi-Fi prints the networks and succeeds', () => {
  fake('nmcli', 'echo "*:70:WPA2:Home"; echo " :40::Cafe"');
  const { status, stdout, stderr } = run('wifi-list');
  assert.equal(stderr, '');
  assert.equal(status, 0);
  assert.equal(stdout, '*:70:WPA2:Home\n :40::Cafe\n');
});

test('anything that is not one of its commands, or names no project user, is refused', () => {
  for (const args of [[], ['wifi-list-all'], ['delete-user', 'root'], ['create-user', 'toto-p-zzzzzzzz'], ['wifi-country', 'gb; reboot'], ['plugin-install'], ['plugin-install', '../gh'], ['plugin-remove', 'gh;reboot'], ['plugin-install', 'Gh']]) assert.equal(run(...args).status, 2, args.join(' '));
});
