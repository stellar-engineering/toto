import { spawn } from 'node:child_process';
import type { TermKey } from '../../protocol.ts';
import { run, command } from './projects.ts';

// A terminal agent is a tmux session owned by the project's user. tmux keeps it alive across
// server restarts and with nobody watching.
//
// tmux is the terminal emulator. We poll it for the finished screen, colour codes included, and
// the app paints that.
//
// ponytail: snapshots, not a byte stream, so updates land a beat behind and each one resends the
// whole screen. The upgrade is a real pty streamed to an emulator in the app (xterm.js in a
// web view), worth it if typing into full-screen programs feels laggy.
const session = (agentId: string) => `toto-${agentId}`;

const KEYS: Record<TermKey, string> = {
  enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'BSpace',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  'ctrl-c': 'C-c', 'ctrl-d': 'C-d',
};
export const isTermKey = (k: unknown): k is TermKey => typeof k === 'string' && Object.hasOwn(KEYS, k);

const ENSURE = `tmux has-session -t "$1" 2>/dev/null || tmux new-session -d -s "$1" -x "$2" -y "$3"; tmux resize-window -t "$1" -x "$2" -y "$3"`;
const SCROLLBACK = 300;
// Prints "cursor_x cursor_y rows", then the scrollback and screen with escape codes, then a NUL;
// until the session ends or nobody is reading.
const WATCH = `while tmux display-message -p -t "$1" '#{cursor_x} #{cursor_y} #{pane_height}' && tmux capture-pane -e -p -S -${SCROLLBACK} -t "$1" && printf '\\0'; do sleep 0.15; done`;

export type Screen = { screen: string; cursor: { row: number; col: number } };

/** Reads one frame of WATCH's output. The cursor comes back as a position within `screen`. */
export function readFrame(frame: string): Screen {
  const [head, ...lines] = frame.replace(/\n$/, '').split('\n');
  const [x = 0, y = 0, rows = lines.length] = head.split(' ').map(Number);
  // The visible rows are the last `rows` lines; everything above is scrollback.
  const row = Math.max(0, lines.length - rows) + y;
  // Blank rows below both the text and the cursor are just the unused part of the pane.
  let last = lines.length - 1;
  while (last > row && lines[last].trim() === '') last--;
  return { screen: lines.slice(0, last + 1).join('\n'), cursor: { row, col: x } };
}

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
export function watchTerminal({ user, cwd, agentId }: Where, onScreen: (screen: Screen) => void) {
  // One long-lived process rather than a sudo call per poll.
  const [file, args, opts] = command(user, cwd, 'sh', ['-c', WATCH, 'sh', session(agentId)]);
  const child = spawn(file, args, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('error', () => {});
  let buffer = '';
  let last: string | undefined;
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    const frames = (buffer + chunk).split('\0');
    buffer = frames.pop()!;
    const frame = frames.pop();
    if (frame !== undefined && frame !== last) onScreen(readFrame((last = frame)));
  });
  // Under sudo the loop is not ours to signal; closing its output ends it at the next write.
  return () => child.stdout.destroy();
}
