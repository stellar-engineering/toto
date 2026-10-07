// Toto's face, as data. Pure, and tested from the server's suite.
//
// The mark is a dog in six characters: `/` and `\` for floppy ears, the two o's from the name for
// eyes, and a bullet for a nose. It moves the way a terminal would move it: every character stays
// where it is and is swapped for another. Nothing slides, turns or stretches.

/** What the face is saying. One per thing an agent, or the link to a Toto, can be doing. */
export type Mood = 'awake' | 'working' | 'waiting' | 'resting' | 'failed' | 'offline' | 'looking';

/**
 * One frame: the ears and eyes (always five characters), anything trailing after them (z's,
 * counting dots), the nose (a space for none), and how long to hold it.
 */
export type Frame = { face: string; extra: string; nose: string; ms: number };

const NOSE = '•';
const f = (face: string, ms: number, nose = NOSE, extra = ''): Frame => ({ face, extra, nose, ms });

export const FRAMES: Record<Mood, Frame[]> = {
  // The everyday loop: blinks, one eye widens and then the other, an ear flicks, the eyes narrow.
  awake: [
    f('/o o\\', 1700), f('/- -\\', 140), f('/o o\\', 1000),
    f('/o O\\', 800), f('/o o\\', 500), f('/O o\\', 800), f('/o o\\', 1100),
    f('|o o\\', 170), f('/o o\\', 900),
    f('/. .\\', 600), f('/o o\\', 500), f('/- -\\', 140),
  ],
  // On the job: eyes open, narrowing in thought, dots counting along beside it. Open eyes also
  // keep it apart from resting at list size, where narrowed and shut look alike.
  working: [
    f('/o o\\', 500), f('/o o\\', 500, NOSE, ' .'), f('/. .\\', 500, NOSE, ' ..'), f('/o o\\', 500, NOSE, ' ...'),
    f('/- -\\', 140),
  ],
  // Ears up, eyes wide, and the nose turns into a question.
  waiting: [f('|O O|', 1500, '?'), f('|- -|', 140, '?'), f('|O O|', 800, '?'), f('\\O O/', 420, '?')],
  // Nothing running. Eyes shut, a few z's.
  resting: [f('/- -\\', 1000), f('/- -\\', 700, NOSE, ' z'), f('/- -\\', 1000, NOSE, ' zZ'), f('/- -\\', 600)],
  // Stopped on an error. Crossed eyes, still.
  failed: [f('/x x\\', 0)],
  // Cannot be reached. The nose is gone.
  offline: [f('/. .\\', 0, ' ')],
  // Trying to find a Toto: peering.
  looking: [f('/. .\\', 450, ' '), f('/o o\\', 450, ' '), f('/. .\\', 450, ' '), f('/O O\\', 450, ' ')],
};

/**
 * The frames for a face that has only its five characters to work with, as in a list or a line
 * of text: trailing extras are dropped, and frames that then look the same are joined.
 */
export function compact(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (const frame of frames) {
    const last = out[out.length - 1];
    if (last && last.face === frame.face && last.nose === frame.nose) last.ms += frame.ms;
    else out.push({ ...frame, extra: '' });
  }
  // The loop wraps round, so the last frame can also match the first.
  if (out.length > 1 && out[0].face === out[out.length - 1].face && out[0].nose === out[out.length - 1].nose)
    out[0].ms += out.pop()!.ms;
  return out;
}

/** The mood for what a chat agent is doing. */
export const moodOf = (activity: 'idle' | 'working' | 'waiting' | 'failed'): Mood =>
  activity === 'idle' ? 'resting' : activity;

/** One mood for a group of agents: whoever most needs attention sets it. */
export function moodOfMany(activities: ('idle' | 'working' | 'waiting' | 'failed')[]): Mood {
  for (const urgent of ['waiting', 'failed', 'working'] as const) if (activities.includes(urgent)) return urgent;
  return 'resting';
}
