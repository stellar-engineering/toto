#!/usr/bin/env node
// Toto's updater. It runs as root, through toto-priv, and takes nothing from whoever asked: the
// address it downloads from and the key it trusts are its own, so the network-facing server can
// ask for an update but cannot choose what gets installed.
//
// An update is only installed if it carries a signature made with Toto's release key, whose public
// half ships in /opt/toto/release.pub, and if it is newer than what is here. That holds whoever
// controls the download: the worst they can do is keep a Toto from updating.
//
//   toto-update.mjs            download, check, unpack, then hand the install to systemd
//   toto-update.mjs install    install what was unpacked; put the old version back if it will not start
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOME = '/opt/toto';
const NEXT = '/opt/toto-next';
const PREVIOUS = '/opt/toto-previous';
const RELEASES = process.env.TOTO_RELEASES ?? 'https://github.com/stellar-engineering/toto/releases/latest/download';
const BIGGEST = 50 * 1024 * 1024;

const isVersion = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);

/** Whether version `a` comes after version `b`. Numbers, not text: 0.10.0 is newer than 0.9.0. */
export function newer(a, b) {
  if (!isVersion(a) || !isVersion(b)) return false;
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** Whether `signature` over `data` was made with the private half of `publicKey` (Ed25519, PEM). */
export function signedBy(publicKey, data, signature) {
  try {
    return verify(null, data, createPublicKey(publicKey), signature);
  } catch {
    return false;
  }
}

const versionIn = (dir) => JSON.parse(readFileSync(`${dir}/server/package.json`, 'utf8')).version;
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
const remove = (path) => rmSync(path, { recursive: true, force: true });

async function download(name) {
  const res = await fetch(`${RELEASES}/${name}`, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined);
  if (!res?.ok) throw new Error('Could not download the update. Check this Toto is online and try again.');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > BIGGEST) throw new Error('The update is larger than an update should be. Nothing was changed.');
  return body;
}

/** Downloads the latest release, and unpacks it only if it is signed and newer. Returns its version. */
async function fetchAndCheck() {
  const [bundle, signature] = await Promise.all([download('toto.tar.gz'), download('toto.tar.gz.sig')]);
  if (!signedBy(readFileSync(`${HOME}/release.pub`), bundle, signature)) throw new Error("The update is not signed with Toto's release key. Nothing was changed.");
  // Only now is anything in it believed, including the version it says it is.
  remove(NEXT);
  mkdirSync(NEXT, { mode: 0o700 });
  writeFileSync(`${NEXT}.tar.gz`, bundle, { mode: 0o600 });
  run('tar', ['xzf', `${NEXT}.tar.gz`, '-C', NEXT, '--no-same-owner']);
  remove(`${NEXT}.tar.gz`);
  const [have, offered] = [versionIn(HOME), versionIn(NEXT)];
  // Newer only: an old release is validly signed too, and must not be a way to bring back a fixed flaw.
  if (!newer(offered, have)) {
    remove(NEXT);
    throw new Error(`This Toto is already up to date (${have}).`);
  }
  return offered;
}

function install() {
  remove(PREVIOUS);
  run('cp', ['-a', HOME, PREVIOUS]);
  try {
    run('bash', [`${NEXT}/install.sh`], { DEBIAN_FRONTEND: 'noninteractive' });
    // The installer restarts the server. Give it time to fall over if it is going to: a server
    // that keeps crashing is "active" for a moment each time systemd starts it again, so being
    // up is not enough. It must also not have been restarted in the meantime.
    const restarts = () => execFileSync('systemctl', ['show', 'toto', '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim();
    const before = restarts();
    run('sleep', ['20']);
    run('systemctl', ['is-active', '--quiet', 'toto']);
    if (restarts() !== before) throw new Error('the new version keeps stopping');
  } catch (err) {
    console.error(`The update did not take (${err.message}). Putting ${versionIn(PREVIOUS)} back.`);
    remove(HOME);
    renameSync(PREVIOUS, HOME);
    remove(NEXT);
    run('systemctl', ['restart', 'toto']);
    process.exit(1);
  }
  remove(NEXT);
  // ponytail: the previous version is kept but only put back automatically, straight after an
  // update. Add a `toto rollback` if a release ever starts fine and misbehaves later.
  console.log(`Updated to ${versionIn(HOME)}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'install') install();
    else {
      const version = await fetchAndCheck();
      // Its own unit, not a child of the server: the install restarts the server, and must outlive it.
      run('systemd-run', ['--unit', 'toto-update', '--collect', '--quiet', '/usr/bin/node', `${HOME}/bin/toto-update.mjs`, 'install']);
      console.log(version);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
