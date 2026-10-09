// Switches for finding things out, set from the app instead of in the server's environment. They
// are kept in a small file of their own and read as they are used, so turning one on needs no restart.
// ponytail: a flag that does need one (read once at start) would want a restart message and a
// toto-priv verb to send it; add them with the first such flag.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flag } from '../../protocol.ts';
import { dataDir } from './projects.ts';

/** Every flag there is. `env` is the way it was set before there were flags, which still works. */
const FLAGS = [
  {
    name: 'debugStream',
    label: 'Keep subagent messages',
    about: 'Saves the messages Claude sends about subagents to a private file on this Toto, to see what is really in them. Shortened, with no pictures.',
    env: 'TOTO_DEBUG_STREAM',
  },
];

const file = join(dataDir, 'flags.json');
const read = (): string[] => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  } catch {
    return [];
  }
};

export const flagOn = (name: string) => read().includes(name) || !!process.env[FLAGS.find((f) => f.name === name)?.env ?? ''];

/** Turns a flag on or off. Throws for one that does not exist. */
export function setFlag(name: unknown, on: unknown) {
  if (!FLAGS.some((f) => f.name === name) || typeof on !== 'boolean') throw new Error('That is not a setting this Toto has.');
  const rest = read().filter((n) => n !== name);
  writeFileSync(file, JSON.stringify(on ? [...rest, name] : rest), { mode: 0o600 });
}

export const describeFlags = (): Flag[] => FLAGS.map(({ name, label, about }) => ({ name, label, about, on: flagOn(name) }));
