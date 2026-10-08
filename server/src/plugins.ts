// Plugins on this device. Putting one there is the root installer's job (bin/toto-plugin.mjs), which
// checks its signature; this file reads what was installed, hears of what could be from the relay,
// and runs a plugin's sign-in as this unprivileged server, never as root.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from '../../protocol.ts';
import { dataDir, sh } from './projects.ts';

const exec = promisify(execFile);
const DIR = process.env.TOTO_PLUGIN_DIR ?? '/var/lib/toto-plugins';
const PRIV = '/opt/toto/bin/toto-priv';
const LISTED = 'https://toto.royletron.dev/plugins/index.json';

export const isPluginName = (n: unknown): n is string => typeof n === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(n);

type Paste = { url: string; help: string; pattern: string; check?: string[] };
type DeviceLogin = { run: string[]; url: string; code: string; token: string[] };
type Login = { env: string; paste?: Paste } & Partial<DeviceLogin>;
type Manifest = { name: string; version: string; description?: string; login?: Login };

/** The plugins installed here. The directory is root's, so what is in it was checked when it was put there. */
export function installed(dir = DIR): Manifest[] {
  try {
    return readdirSync(dir)
      .filter(isPluginName)
      .flatMap((name) => {
        try {
          const m = JSON.parse(readFileSync(`${dir}/${name}/manifest.json`, 'utf8'));
          return m?.name === name ? [m as Manifest] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** The plugins the relay says exist. A hint for what to offer: the device checks whatever it installs. */
export async function listed(): Promise<Manifest[]> {
  const res = await fetch(LISTED, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  const found = await res?.json().catch(() => undefined);
  return Array.isArray(found) ? found.filter((m) => isPluginName(m?.name) && /^\d+\.\d+\.\d+$/.test(m.version) && typeof m.description === 'string') : [];
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
};

/** What the app is shown: everything installed, and everything the relay lists that is not. */
export function describe(have: Manifest[], offered: Manifest[], env: Record<string, string | undefined> = process.env): Plugin[] {
  const names = [...new Set([...have, ...offered].map((m) => m.name))].sort();
  return names.map((name) => {
    const mine = have.find((m) => m.name === name);
    const theirs = offered.find((m) => m.name === name);
    const login = mine?.login ?? theirs?.login;
    return {
      name,
      description: String(mine?.description ?? theirs?.description ?? ''),
      ...(mine ? { version: mine.version } : null),
      ...(mine && theirs && newer(theirs.version, mine.version) ? { latest: theirs.version } : null),
      ...(login ? { login: true } : null),
      ...(mine?.login?.paste ? { paste: { url: mine.login.paste.url, help: mine.login.paste.help } } : null),
      ...(mine?.login && env[mine.login.env] ? { signedIn: true } : null),
    };
  });
}

export const installPlugin = (name: string) => sh('sudo', ['-n', PRIV, 'plugin-install', name]);
export const removePlugin = (name: string) => sh('sudo', ['-n', PRIV, 'plugin-remove', name]);

// What a sign-in earned, kept for the next start: environment variable name -> token.
const tokenFile = join(dataDir, 'plugin-tokens.json');
const tokens = (): Record<string, string> => (existsSync(tokenFile) ? JSON.parse(readFileSync(tokenFile, 'utf8')) : {});

/** The names of the variables plugins' sign-ins fill in, for agents to be given. */
export const loginNames = (dir = DIR) => installed(dir).flatMap((m) => (m.login ? [m.login.env] : []));

/** Puts every saved sign-in back in the environment. */
export function useTokens() {
  for (const [name, value] of Object.entries(tokens())) if (loginNames().includes(name)) process.env[name] = value;
}

/** Remembers a token for next time, or forgets it. */
export function keepToken(name: string, value: string | undefined) {
  const all = tokens();
  if (value === undefined) delete all[name];
  else all[name] = value;
  writeFileSync(tokenFile, JSON.stringify(all), { mode: 0o600 });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** Whether a token the person pasted is of the right shape and, if the plugin can tell, works. Throws why not. */
export async function checkToken(login: Login, token: unknown): Promise<string> {
  const paste = login.paste;
  const value = typeof token === 'string' ? token.trim() : '';
  if (!paste || value.length > 500 || !new RegExp(paste.pattern).test(value)) throw new Error('That does not look like the token. Copy all of it from the page, and nothing else.');
  if (paste.check) {
    const home = mkdtempSync(join(tmpdir(), 'toto-login-'));
    const [file, ...args] = paste.check;
    // The token reaches the command in its environment only, never on its command line.
    const worked = await exec(file, args, { env: { ...process.env, HOME: home, [login.env]: value }, timeout: 30_000 }).then(() => true, () => false);
    rmSync(home, { recursive: true, force: true });
    if (!worked) throw new Error('That token was not accepted. Check it was copied whole, and has the permissions it needs.');
  }
  return value;
}

// --- A plugin's sign-in. The plugin names a command that shows a web address and a code and then
// waits for the person to enter it there. We give it a terminal (tmux, as the Claude sign-in does),
// read the address and code off its screen for the phone to show, and when it ends ask the plugin's
// other command for the token it earned. It runs with a home directory of its own, thrown away
// after, so nothing is left behind but the token.
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const tmux = (...args: string[]) => exec('tmux', args, { timeout: 10_000 });
const session = (name: string) => `toto-login-${name}`;

export const cancelPluginLogin = (name: string) => tmux('kill-session', '-t', session(name)).catch(() => {});

/**
 * Starts the sign-in and resolves to what the phone should show. `done` is called, much later, with
 * the token or with why there is none.
 */
export async function startPluginLogin(login: DeviceLogin, name: string, done: (token?: string, why?: string) => void): Promise<{ url: string; code: string }> {
  await cancelPluginLogin(name);
  const home = mkdtempSync(join(tmpdir(), 'toto-login-'));
  const finish = (token?: string, why?: string) => {
    rmSync(home, { recursive: true, force: true });
    done(token, why);
  };
  try {
    // Wide, so that an address is not broken across lines. -J below joins the lines that were.
    await tmux('new-session', '-d', '-s', session(name), '-x', '500', '-y', '50', 'env', `HOME=${home}`, ...login.run);
    const url = new RegExp(login.url);
    const code = new RegExp(login.code);
    let seen = '';
    let ended = false;
    for (const until = Date.now() + 30_000; Date.now() < until && !ended && !(url.test(seen) && code.test(seen)); await wait(400))
      seen = await tmux('capture-pane', '-p', '-J', '-t', session(name)).then((r) => r.stdout, () => ((ended = true), seen));
    const found = { url: url.exec(seen)?.[0], code: code.exec(seen)?.[0] };
    if (!found.url || !found.code) throw new Error(`The sign-in did not show a code to enter. Try again; if it keeps happening, ${name} may have changed how it signs in.`);
    // Waits for the person: until the sign-in ends of its own accord, or they give up.
    void (async () => {
      for (const until = Date.now() + 15 * 60_000; Date.now() < until; await wait(2000)) {
        if (await tmux('has-session', '-t', session(name)).then(() => false, () => true)) break;
      }
      const [file, ...args] = login.token;
      const token = await exec(file, args, { env: { ...process.env, HOME: home }, timeout: 15_000 }).then((r) => r.stdout.trim(), () => '');
      await cancelPluginLogin(name);
      token ? finish(token) : finish(undefined, 'The sign-in was not finished. Start again.');
    })();
    return { url: found.url, code: found.code };
  } catch (err) {
    await cancelPluginLogin(name);
    rmSync(home, { recursive: true, force: true });
    throw err instanceof Error ? err : new Error('Could not start the sign-in.');
  }
}
