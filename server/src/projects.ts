import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentEvent, Identity } from '../../protocol.ts';

const exec = promisify(execFile);

export const dataDir = process.env.TOTO_DATA_DIR ?? join(homedir(), '.toto');
// Set by install.sh. Without it (development on a laptop) projects run as the server's own user.
const isolate = process.env.TOTO_ISOLATE === '1';
const PRIV = '/opt/toto/bin/toto-priv';

// Credentials agents need. sudo logs any environment it is handed, so these never go through
// it: they are written to a private file in each project user's home (over stdin), and every
// command run as that user reads the file on its way in.
const SECRETS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
const INSTALL_ENV = `umask 077 && cat > "$HOME/.toto-env"`;
const WITH_ENV = `[ -r "$HOME/.toto-env" ] && . "$HOME/.toto-env"; exec "$@"`;
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** The credentials in `env` as a file a POSIX shell can source. */
export const envFile = (env: Record<string, string | undefined>) =>
  SECRETS.filter((name) => env[name]).map((name) => `export ${name}=${quote(env[name]!)}\n`).join('');

/**
 * The argv that runs `cmd` in `cwd` as a project's Linux user. The server cannot enter a project's
 * home itself, so the directory change happens on the far side of sudo.
 */
export function command(
  user: string | undefined,
  cwd: string,
  cmd: string,
  args: string[],
): [string, string[], { cwd?: string }] {
  return user
    ? ['sudo', ['-n', '-H', '-u', user, '--', 'env', '-C', cwd, 'sh', '-c', WITH_ENV, 'sh', cmd, ...args], {}]
    : [cmd, args, { cwd }];
}

/** Runs to completion, feeding `input` to stdin; on failure throws the most telling line of its stderr. */
const sh = (file: string, args: string[], opts: { cwd?: string } = {}, input = '') => {
  const done = exec(file, args, { ...opts, timeout: 10 * 60_000 });
  done.child.stdin?.end(input);
  return done.catch((err) => {
    const lines = String(err.stderr || err.message).trim().split('\n');
    throw new Error(lines.find((l) => /permission denied|fatal:|error:/i.test(l)) ?? lines.pop());
  });
};
export const run = (user: string | undefined, cwd: string, cmd: string, args: string[], input?: string) => {
  const [file, argv, opts] = command(user, cwd, cmd, args);
  return sh(file, argv, opts, input);
};

// ponytail: one key for the whole device, copied into every project, so any project's agents can
// reach every repo the key can. Per-project deploy keys are the tighter upgrade.
const keyFile = join(dataDir, 'id_ed25519');

/** The device's public SSH key, created on first use. Undefined in development, where git uses your own keys. */
export async function deviceKey(): Promise<string | undefined> {
  if (!isolate) return undefined;
  if (!existsSync(keyFile))
    await sh('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `toto@${hostname()}`, '-f', keyFile]);
  return readFileSync(keyFile + '.pub', 'utf8').trim();
}

// Run in a new project user's home with the private key on stdin. accept-new trusts a git host the
// first time it is seen and refuses it if its key ever changes.
const INSTALL_KEY = `umask 077 && mkdir -p .ssh && cat > .ssh/id_ed25519 && printf 'Host *\\n  StrictHostKeyChecking accept-new\\n' > .ssh/config`;

// An scp-style or ssh:// address. Leading characters are restricted so nothing can pass for an ssh option.
const SSH_REPO = /^(ssh:\/\/)?[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*[:/][\w.~/-]+$/;

type ProjectDir = { user?: string; dir: string };

/** Gives a project user the server's current credentials. A no-op in development, where agents inherit them. */
export async function installEnv(user: string | undefined) {
  if (!user) return;
  await run(user, `/home/${user}`, 'sh', ['-c', INSTALL_ENV], envFile(process.env));
}

/**
 * Sets who a project's commits are attributed to. Only for isolated projects: in development
 * the project user is you, and your own git config stands.
 */
export async function applyIdentity({ user, dir }: ProjectDir, { name, email }: Identity) {
  if (!user) return;
  await run(user, dirname(dir), 'git', ['config', '--global', 'user.name', name]);
  await run(user, dirname(dir), 'git', ['config', '--global', 'user.email', email]);
}

/** Creates the project's Linux user (when isolating) and clones `repo` into it. */
export async function createProject(id: string, repo: string, identity: Identity): Promise<ProjectDir> {
  // https or ssh only: rules out local paths and git's command-running transports.
  if (!/^https:\/\/\S+$/.test(repo) && !SSH_REPO.test(repo))
    throw new Error('The repository must look like git@github.com:owner/repo.git or https://…');
  const user = isolate ? `toto-p-${id}` : undefined;
  const home = user ? `/home/${user}` : join(dataDir, 'projects', id);
  if (user) await sh('sudo', ['-n', PRIV, 'create-user', user]);
  else mkdirSync(home, { recursive: true });
  try {
    if (user) await run(user, home, 'sh', ['-c', INSTALL_KEY], readFileSync(keyFile, 'utf8'));
    await installEnv(user);
    await run(user, home, 'git', ['clone', '--', repo, 'repo']);
    await applyIdentity({ user, dir: join(home, 'repo') }, identity);
  } catch (err) {
    await removeProject(id, user).catch(() => {});
    if (/permission denied \(publickey\)/i.test(String(err)))
      throw new Error('The SSH key for this Toto has no access to that repository. Add the key to your git host and try again.');
    throw err;
  }
  return { user, dir: join(home, 'repo') };
}

/** Opens or closes the local network to a project's user. A no-op in development. */
export async function setLan(user: string | undefined, allow: boolean) {
  if (user) await sh('sudo', ['-n', PRIV, allow ? 'allow-lan' : 'restrict-lan', user]);
}

/** The Wi-Fi networks in range, strongest first, and which one this device is on. */
export async function wifiList(): Promise<{ list: { ssid: string; signal: number; secure: boolean }[]; current: string | null }> {
  const { stdout } = await exec('sudo', ['-n', PRIV, 'wifi-list'], { timeout: 30_000 });
  const best = new Map<string, { ssid: string; signal: number; secure: boolean }>();
  let current: string | null = null;
  for (const line of stdout.split('\n')) {
    // IN-USE:SIGNAL:SECURITY:SSID, where a colon inside the name is written "\:".
    const [inUse, signal, security, ...name] = line.split(/(?<!\\):/);
    const ssid = name.join(':').replace(/\\(.)/g, '$1');
    if (!ssid) continue; // hidden networks have no name to offer
    if (inUse === '*') current = ssid;
    const seen = best.get(ssid);
    if (!seen || Number(signal) > seen.signal) best.set(ssid, { ssid, signal: Number(signal) || 0, secure: !!security && security !== '--' });
  }
  return { list: [...best.values()].sort((a, b) => b.signal - a.signal).slice(0, 20), current };
}

/** Joins a Wi-Fi network, keeping the one already configured to fall back on. Throws with the reason if it cannot. */
export const wifiJoin = (ssid: string, password: string) => sh('sudo', ['-n', PRIV, 'wifi-join', ssid], {}, password + '\n');

/** Deletes a project's files. When isolating that is its Linux user, along with anything still running as it. */
export async function removeProject(id: string, user: string | undefined) {
  if (user) await sh('sudo', ['-n', PRIV, 'delete-user', user]);
  else rmSync(join(dataDir, 'projects', id), { recursive: true, force: true });
}

/** Removes an agent's checkout, uncommitted work included. Its branch stays in the repo. */
export const removeWorktree = (project: ProjectDir, dir: string) =>
  run(project.user, project.dir, 'git', ['worktree', 'remove', '--force', dir]);

/** Gives an agent its own checkout on a new branch. Returns the directory. */
export async function addWorktree(project: ProjectDir, agentId: string): Promise<string> {
  const dir = join(project.dir, '..', 'agents', agentId);
  await run(project.user, project.dir, 'git', ['worktree', 'add', '-b', `toto/${agentId}`, dir]);
  return dir;
}

/** Ids of the tool calls in `log` still waiting on an approval decision. */
export function openApprovals(log: AgentEvent[]): string[] {
  const open = new Set<string>();
  for (const e of log) {
    if (e.type === 'approval_request') open.add(e.id);
    if (e.type === 'approval_resolved') open.delete(e.id);
  }
  return [...open];
}
