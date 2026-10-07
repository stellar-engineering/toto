// The parser lives in the app, but is plain TypeScript, so it is tested here where there is a test runner.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const source = new URL('../../app/src/ansi.ts', import.meta.url);
const skip = !existsSync(source); // an installed server has no app beside it
const { parse, withCursor, indexed } = skip ? ({} as any) : await import(source.href);
const E = '\x1b';

test('reads colours and styles, and carries them across lines', { skip }, () => {
  assert.deepEqual(parse(`plain ${E}[1;31mred bold${E}[0m back`), [
    [{ text: 'plain ' }, { bold: true, fg: '#F25C82', text: 'red bold' }, { text: ' back' }],
  ]);
  // No reset before the newline: the green is still on for the second line.
  assert.deepEqual(parse(`${E}[32mone\ntwo${E}[m`), [[{ fg: '#8BD45F', text: 'one' }], [{ fg: '#8BD45F', text: 'two' }]]);
  assert.deepEqual(parse(`${E}[38;5;196;48;2;1;2;3mx${E}[39;49my`)[0], [
    { fg: '#ff0000', bg: '#010203', text: 'x' },
    { fg: undefined, bg: undefined, text: 'y' },
  ]);
  assert.deepEqual(parse(`${E}[7;4minv${E}[27;24mnot`)[0], [
    { inverse: true, underline: true, text: 'inv' },
    { inverse: false, underline: false, text: 'not' },
  ]);
  assert.equal(indexed(232), '#080808');
  assert.equal(indexed(999), undefined);
});

test('drops sequences that are not colour or style', { skip }, () => {
  const text = (s: string) => parse(s)[0].map((span: { text: string }) => span.text).join('');
  assert.equal(text(`a${E}[2Kb${E}[10;5Hc`), 'abc'); // erase line, move cursor
  assert.equal(text(`${E}]8;;https://x.y${E}\\link${E}]8;;${E}\\`), 'link'); // hyperlink
  assert.equal(text(`${E}]0;title\x07shown${E}(B`), 'shown'); // window title, charset
});

test('places the cursor', { skip }, () => {
  const line = parse(`ab${E}[31mcd`)[0];
  assert.deepEqual(withCursor(line, 2).map((s: any) => [s.text, !!s.cursor]), [['ab', false], ['c', true], ['d', false]]);
  assert.deepEqual(withCursor(line, 0).map((s: any) => [s.text, !!s.cursor]), [['a', true], ['b', false], ['cd', false]]);
  // Past the end of the text, as at an empty prompt.
  assert.deepEqual(withCursor(line, 6).map((s: any) => [s.text, !!s.cursor]), [['ab', false], ['cd', false], ['  ', false], [' ', true]]);
  assert.deepEqual(withCursor([], 0).map((s: any) => [s.text, !!s.cursor]), [[' ', true]]);
});

const keys = new URL('../../app/src/keys.ts', import.meta.url);
const { typed } = skip ? ({} as any) : await import(keys.href);

test('works out keystrokes from how a text field changed', { skip }, () => {
  assert.deepEqual(typed('xx', 'xxa'), { backspaces: 0, text: 'a' });
  assert.deepEqual(typed('xxab', 'xxa'), { backspaces: 1, text: '' });
  assert.deepEqual(typed('xx', 'x'), { backspaces: 1, text: '' }); // backspace into the filler
  assert.deepEqual(typed('xxls', 'xxls -la'), { backspaces: 0, text: ' -la' }); // several at once, as when pasting
  assert.deepEqual(typed('xxteh', 'xxthe '), { backspaces: 2, text: 'he ' }); // the keyboard rewrote a word
  assert.deepEqual(typed('xx', 'xx’“—…'), { backspaces: 0, text: `'"--...` }); // smart punctuation undone
  assert.deepEqual(typed('abc', 'abc'), { backspaces: 0, text: '' });
});

test("the app's copy of moods.ts is identical to the server's", { skip }, async () => {
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(new URL('../../app/src/moods.ts', import.meta.url), 'utf8'), readFileSync(new URL('./moods.ts', import.meta.url), 'utf8'));
});

const moods = new URL('../../app/src/moods.ts', import.meta.url);
const { FRAMES, compact, moodOf, moodOfMany } = skip ? ({} as any) : await import(moods.href);

test("Toto's face: every frame is five characters, and a nose", { skip }, () => {
  for (const [mood, frames] of Object.entries(FRAMES) as [string, any[]][]) {
    assert.ok(frames.length > 0, mood);
    for (const frame of frames) {
      assert.equal(frame.face.length, 5, `${mood}: "${frame.face}"`);
      assert.equal([...frame.nose].length, 1, `${mood}: nose "${frame.nose}"`);
      assert.ok(frames.length === 1 || frame.ms > 0, `${mood}: a moving face needs a time on every frame`);
    }
  }
});

test("Toto's face: the one-line version drops the extras and joins what then repeats", { skip }, () => {
  const working = compact(FRAMES.working);
  assert.ok(working.every((frame: any) => frame.extra === ''));
  // Two frames of open eyes with dots counting become one long one.
  assert.deepEqual(working.map((frame: any) => [frame.face, frame.ms]), [['/o o\\', 1000], ['/. .\\', 500], ['/o o\\', 500], ['/- -\\', 140]]);
  // Resting is the same shut eyes throughout, so it holds still.
  assert.equal(compact(FRAMES.resting).length, 1);
  // The total time is kept.
  const total = (frames: any[]) => frames.reduce((sum, frame) => sum + frame.ms, 0);
  assert.equal(total(compact(FRAMES.awake)), total(FRAMES.awake));
});

test("Toto's face: the most pressing agent sets the mood for a group", { skip }, () => {
  assert.equal(moodOf('idle'), 'resting');
  assert.equal(moodOf('waiting'), 'waiting');
  assert.equal(moodOfMany([]), 'resting');
  assert.equal(moodOfMany(['idle', 'working']), 'working');
  assert.equal(moodOfMany(['working', 'failed']), 'failed');
  assert.equal(moodOfMany(['failed', 'waiting', 'working']), 'waiting');
});
