// Signing a Toto in to Claude from a phone.
//
// Claude Code has its own sign-in for subscriptions, `claude setup-token`: it shows a link, waits
// for the code that link's page hands back, and then prints a token good for a year. It expects a
// person at a terminal, so we give it a terminal (tmux), read the link off its screen for the app
// to open, and type the code in when the app sends it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SESSION = 'toto-claude-login';
const bin = () => process.env.TOTO_CLAUDE_BIN ?? 'claude';
const tmux = (...args: string[]) => exec('tmux', args, { timeout: 10_000 });
// -J joins lines the terminal wrapped, which a long link or token always is.
const screen = async () => (await tmux('capture-pane', '-p', '-J', '-t', SESSION)).stdout;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Polls the sign-in's screen until `find` matches or time runs out. */
async function watchFor(find: RegExp, patience: number): Promise<{ found?: string; last: string }> {
  let last = '';
  for (const until = Date.now() + patience; Date.now() < until; await wait(400)) {
    last = await screen().catch(() => last);
    const found = find.exec(last)?.[0];
    if (found) return { found, last };
  }
  return { last };
}

let abandoned: ReturnType<typeof setTimeout> | undefined;

export const cancelLogin = () => tmux('kill-session', '-t', SESSION).catch(() => {});

/** Starts a sign-in and resolves to the link the person should open. */
export async function startLogin(): Promise<string> {
  await cancelLogin();
  // Very wide: the sign-in breaks its long link into lines at the terminal's width, and a link
  // broken across lines cannot be read back whole.
  await tmux('new-session', '-d', '-s', SESSION, '-x', '2000', '-y', '50', bin(), 'setup-token').catch(() => {
    throw new Error('This Toto could not start the Claude sign-in. Is tmux installed?');
  });
  const { found } = await watchFor(/https:\/\/\S+oauth\S+/, 30_000);
  // A sign-in nobody finishes should not sit there for ever.
  clearTimeout(abandoned);
  abandoned = setTimeout(cancelLogin, 15 * 60_000);
  abandoned.unref();
  if (found) return found;
  await cancelLogin();
  throw new Error('Claude did not offer a sign-in link. Check this Toto is online and try again.');
}

/** Gives the sign-in the code from the browser, and resolves to the token it produces. */
export async function finishLogin(code: string): Promise<string> {
  // The code is typed as text, never run: -l sends the characters literally.
  await tmux('send-keys', '-t', SESSION, '-l', '--', code.trim()).catch(() => {
    throw new Error('That sign-in has expired. Start again.');
  });
  await tmux('send-keys', '-t', SESSION, 'Enter');
  const { found, last } = await watchFor(/sk-ant-oat\d\d-[A-Za-z0-9_-]{20,}/, 45_000);
  await cancelLogin();
  if (found) return found;
  throw new Error(/invalid|expired|error|failed/i.test(last) ? 'Claude did not accept that code. Start again and paste the whole code.' : 'Claude did not finish signing in. Start again.');
}

/** Asks Claude one tiny question to see whether the credentials in the environment work. */
export async function credentialsWork(): Promise<boolean> {
  try {
    const { stdout } = await exec(bin(), ['-p', 'Reply with the single word: ok', '--output-format', 'json'], { timeout: 60_000 });
    return JSON.parse(stdout).is_error === false;
  } catch {
    return false;
  }
}
