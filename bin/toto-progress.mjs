// What a root task (an update, a plugin install) is doing, for the server to pass on to the app.
// Root writes it and anyone may read it; nothing in it is believed for anything but showing.
//
// One file for the latest task: { task, text, step, of, at, done, failed }. The server reads it
// while a task is under way, and again when it starts, because an update restarts the server in the
// middle of itself.
import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';

const FILE = process.env.TOTO_PROGRESS ?? '/var/lib/toto-progress.json';

function write(record) {
  try {
    writeFileSync(`${FILE}.tmp`, JSON.stringify({ ...record, at: Date.now() }), { mode: 0o644 });
    renameSync(`${FILE}.tmp`, FILE);
  } catch {
    // Telling people how it is going is never worth stopping for.
  }
}

/** The last line of whatever a command printed, without the colour and cursor codes. */
export const lastLine = (text) =>
  text
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
    ?.slice(0, 100) ?? '';

/** Progress for one task of `of` steps, `from` of them done already. `task` is 'update' or 'plugin:<name>'. */
export function track(task, of, from = 0) {
  let step = from;
  let last = 0;
  const say = (text, extra = {}) => write({ task, text, step, of, ...extra });
  return {
    /** Moves to the next step. */
    next(text) {
      step++;
      say(text);
    },
    /** Runs a command as the current step, showing the last line it prints. Rejects with that line if it fails. */
    run(text, cmd, args, env = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
        let tail = '';
        const seen = (chunk) => {
          tail = (tail + chunk).slice(-2000);
          // Many lines go by; one write in a few is plenty to show it moving.
          if (Date.now() - last < 400) return;
          last = Date.now();
          const line = lastLine(tail);
          if (line) say(`${text}: ${line}`);
        };
        child.stdout.on('data', seen);
        child.stderr.on('data', seen);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(lastLine(tail) || `${cmd} stopped with ${code}`))));
      });
    },
    done: (text) => say(text, { done: true }),
    fail: (text) => say(text, { done: true, failed: true }),
  };
}
