import { spawn } from 'node:child_process';
import type { TermKey } from '../../protocol.ts';
import { run, command } from './projects.ts';

// A terminal agent is a tmux session owned by the project's user. tmux keeps it alive across
// server restarts and with nobody watching.
//
// ponytail: the screen travels as plain text snapshots, polled. No colours, no cursor, ~0.3s lag.
// The upgrade is a real pty (node-pty) streamed to a terminal emulator in the app.
const session = (agentId: string) => `toto-${agentId}`;

const KEYS: Record<TermKey, string> = {
  enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'BSpace',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  'ctrl-c': 'C-c', 'ctrl-d': 'C-d',
};
export const isTermKey = (k: unknown): k is TermKey => typeof k === 'string' && Object.hasOwn(KEYS, k);

const ENSURE = `tmux has-session -t "$1" 2>/dev/null || tmux new-session -d -s "$1" -x "$2" -y "$3"; tmux resize-window -t "$1" -x "$2" -y "$3"`;
// Prints the screen followed by a NUL, until the session ends or nobody is reading.
const WATCH = `while tmux capture-pane -p -t "$1" && printf '\\0'; do sleep 0.3; done`;

type Where = { user?: string; cwd: string; agentId: string };

/** Creates the session if it is not there, and fits it to the viewer's screen. */
export const openTerminal = ({ user, cwd, agentId }: Where, cols: number, rows: number) =>
  run(user, cwd, 'sh', ['-c', ENSURE, 'sh', session(agentId), String(cols), String(rows)]);

/** Types `text` into the session, then presses `key`. */
export async function sendToTerminal({ user, cwd, agentId }: Where, text?: string, key?: TermKey) {
  if (text) await run(user, cwd, 'tmux', ['send-keys', '-t', session(agentId), '-l', '--', text]);
  if (key) await run(user, cwd, 'tmux', ['send-keys', '-t', session(agentId), KEYS[key]]);
}

export const killTerminal = ({ user, cwd, agentId }: Where) =>
  run(user, cwd, 'tmux', ['kill-session', '-t', session(agentId)]).catch(() => {});

/** Calls `onScreen` with the session's screen each time it changes. Returns a function that stops watching. */
export function watchTerminal({ user, cwd, agentId }: Where, onScreen: (screen: string) => void) {
  // One long-lived process rather than a sudo call per poll.
  const [file, args, opts] = command(user, cwd, 'sh', ['-c', WATCH, 'sh', session(agentId)]);
  const child = spawn(file, args, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => {});
  let buffer = '';
  let last: string | undefined;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    const frames = (buffer + chunk).split('\0');
    buffer = frames.pop()!;
    const screen = frames.pop()?.trimEnd();
    if (screen !== undefined && screen !== last) onScreen((last = screen));
  });
  // Under sudo the loop is not ours to signal; closing its output ends it at the next write.
  return () => child.stdout.destroy();
}
