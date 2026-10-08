#!/usr/bin/env node
// Packs every plugin in this directory into a signed bundle, and lists them:  PLUGIN_KEY=... node plugins/pack.mjs site/plugins
// Writes <name>.tar.gz, <name>.tar.gz.sig and index.json. The key is the private half of /plugin.pub;
// it exists only as a secret, and must not be on a command line. The list is only for showing what
// there is: a Toto checks the signature of whatever it installs.
import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signedBy } from '../bin/toto-update.mjs';

const out = process.argv[2];
const here = fileURLToPath(new URL('.', import.meta.url));
const publicKey = readFileSync(new URL('../plugin.pub', import.meta.url));
mkdirSync(out, { recursive: true });
const index = [];
for (const name of readdirSync(here, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const bundle = execFileSync('tar', ['czf', '-', '-C', `${here}${name}`, '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '.']);
  const signature = sign(null, bundle, process.env.PLUGIN_KEY);
  if (!signedBy(publicKey, bundle, signature)) throw new Error('PLUGIN_KEY does not match plugin.pub');
  writeFileSync(`${out}/${name}.tar.gz`, bundle);
  writeFileSync(`${out}/${name}.tar.gz.sig`, signature);
  const { version, description, login } = JSON.parse(readFileSync(`${here}${name}/manifest.json`, 'utf8'));
  index.push({ name, version, description, ...(login ? { login: true } : null) });
}
writeFileSync(`${out}/index.json`, JSON.stringify(index));
