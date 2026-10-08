#!/usr/bin/env node
// Packs a plugin from this directory into a signed bundle:  PLUGIN_KEY=... node plugins/pack.mjs gh site/plugins
// Writes <name>.tar.gz and <name>.tar.gz.sig. The key is the private half of /plugin.pub; it exists
// only as a secret, and must not be on a command line.
import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signedBy } from '../bin/toto-update.mjs';

const [name, out] = process.argv.slice(2);
const here = fileURLToPath(new URL('.', import.meta.url));
const bundle = execFileSync('tar', ['czf', '-', '-C', `${here}${name}`, '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '.']);
const signature = sign(null, bundle, process.env.PLUGIN_KEY);
if (!signedBy(readFileSync(new URL('../plugin.pub', import.meta.url)), bundle, signature)) throw new Error('PLUGIN_KEY does not match plugin.pub');
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/${name}.tar.gz`, bundle);
writeFileSync(`${out}/${name}.tar.gz.sig`, signature);
