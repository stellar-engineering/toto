#!/usr/bin/env node
// Installs or removes a Toto plugin. It runs as root, through toto-priv, and takes nothing from
// whoever asked but the plugin's name: where bundles come from and the key they must be signed
// with are its own, so the network-facing server can ask for a plugin but not choose its contents.
//
// A plugin is a tar.gz with a manifest.json at its top, signed with the plugin key (not the release
// key: plugins ship on their own) whose public half is /opt/toto/plugin.pub. The relay hosts the
// bundles, but is not believed: a bundle it altered, or made up, fails the signature and is dropped.
// The manifest lists the packages to install from apt; nothing in a bundle is ever run as root.
//
//   toto-plugin.mjs install <name>
//   toto-plugin.mjs remove <name>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newer, signedBy } from './toto-update.mjs';

const PLUGINS = process.env.TOTO_PLUGINS ?? 'https://toto.royletron.dev/plugins';
const DIR = '/var/lib/toto-plugins';
const BIGGEST = 20 * 1024 * 1024;

export const isName = (n) => typeof n === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(n);
const isPackage = (p) => typeof p === 'string' && /^[a-z0-9][a-z0-9.+-]{0,60}$/.test(p);

const isArgv = (a) => Array.isArray(a) && a.length >= 1 && a.length <= 20 && a.every((s) => typeof s === 'string' && s.length <= 200);
const isPattern = (s) => {
  try {
    return typeof s === 'string' && s.length <= 200 && !!new RegExp(s);
  } catch {
    return false;
  }
};

/**
 * Whether `login` is a sign-in the server may run for the person, as itself and not as root: a
 * command that shows a web address and a code, then a command that prints the token it earned.
 * The token goes to agents in the environment variable `env`, which must end like a secret's name.
 */
export const isLogin = (l) =>
  isArgv(l?.run) && isArgv(l.token) && isPattern(l.url) && isPattern(l.code) && /^[A-Z][A-Z0-9_]{0,40}_(TOKEN|KEY)$/.test(l.env) && (l.enter === undefined || typeof l.enter === 'boolean');

/** Throws unless a manifest is for plugin `name` and asks only for what a plugin may ask for. */
export function checkManifest(m, name) {
  if (m?.name !== name) throw new Error(`That bundle is not the ${name} plugin. Nothing was installed.`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('The plugin has no valid version. Nothing was installed.');
  if (m.apt !== undefined && !(Array.isArray(m.apt) && m.apt.length <= 10 && m.apt.every(isPackage))) throw new Error('The plugin asks for packages that are not valid. Nothing was installed.');
  if (m.login !== undefined && !isLogin(m.login)) throw new Error('The plugin has a sign-in that is not valid. Nothing was installed.');
}

/**
 * Installs a bundle into `dir/<name>` if it is signed with `publicKey` and is the plugin asked for,
 * and newer than any already there. `apt` installs the packages its manifest lists. Returns the version.
 */
export function install(name, bundle, signature, { publicKey, dir = DIR, apt }) {
  if (!isName(name)) throw new Error('That is not a plugin name.');
  if (!signedBy(publicKey, bundle, signature)) throw new Error("The plugin is not signed with Toto's plugin key. Nothing was installed.");
  // Only now is anything in it believed, including what it says it is.
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  const work = mkdtempSync(`${dir}/.incoming-`);
  try {
    const staged = `${work}/plugin`;
    mkdirSync(staged);
    writeFileSync(`${work}/bundle.tar.gz`, bundle);
    execFileSync('tar', ['xzf', `${work}/bundle.tar.gz`, '-C', staged, '--no-same-owner']);
    const manifest = JSON.parse(readFileSync(`${staged}/manifest.json`, 'utf8'));
    checkManifest(manifest, name);
    const have = existsSync(`${dir}/${name}/manifest.json`) ? JSON.parse(readFileSync(`${dir}/${name}/manifest.json`, 'utf8')).version : undefined;
    // Newer only: an old bundle is validly signed too, and must not bring back a fixed flaw.
    if (have && !newer(manifest.version, have)) throw new Error(`${name} ${have} is already installed.`);
    if (manifest.apt?.length) apt(manifest.apt);
    rmSync(`${dir}/${name}`, { recursive: true, force: true });
    renameSync(staged, `${dir}/${name}`);
    return manifest.version;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const aptInstall = (packages) =>
  execFileSync('apt-get', ['install', '-y', '--no-install-recommends', '--', ...packages], { stdio: 'inherit', env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
  if (!res?.ok) throw new Error('Could not download the plugin. Check this Toto is online and try again.');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > BIGGEST) throw new Error('The plugin is larger than a plugin should be. Nothing was installed.');
  return body;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [verb, name] = process.argv.slice(2);
    if (!isName(name)) throw new Error('usage: toto-plugin.mjs install|remove <name>');
    if (verb === 'install') {
      const [bundle, signature] = await Promise.all([download(`${PLUGINS}/${name}.tar.gz`), download(`${PLUGINS}/${name}.tar.gz.sig`)]);
      console.log(install(name, bundle, signature, { publicKey: readFileSync('/opt/toto/plugin.pub'), apt: aptInstall }));
    } else if (verb === 'remove') {
      // ponytail: the packages it installed stay, as another plugin or the person may use them.
      rmSync(`${DIR}/${name}`, { recursive: true, force: true });
    } else throw new Error('usage: toto-plugin.mjs install|remove <name>');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
