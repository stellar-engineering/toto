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
