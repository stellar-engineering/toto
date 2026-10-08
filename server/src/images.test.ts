import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { toEvents } from './claude.ts';
import { dropImages, readImage, saveImage } from './images.ts';

const root = mkdtempSync(join(tmpdir(), 'toto-images-'));
// A real, tiny PNG.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a picture is kept once, read back whole, and gone with its agent', () => {
  const ref = saveImage('ab12cd34', 'image/png', png, root)!;
  assert.match(ref.id, /^[0-9a-f]{16}$/);
  assert.equal(ref.bytes, Buffer.from(png, 'base64').length);
  assert.deepEqual(saveImage('ab12cd34', 'image/png', png, root), ref);
  assert.equal(readdirSync(join(root, 'images', 'ab12cd34')).length, 1);
  assert.equal(readImage('ab12cd34', ref.id, root)!.toString('base64'), png);
  // Another agent's conversation cannot be read by naming this picture.
  assert.equal(readImage('ffffffff', ref.id, root), undefined);
  dropImages('ab12cd34', root);
  assert.equal(readImage('ab12cd34', ref.id, root), undefined);
});

test('what is not a picture, or would step outside its folder, is refused', () => {
  assert.equal(saveImage('ab12cd34', 'text/html', png, root), undefined);
  assert.equal(saveImage('ab12cd34', 'image/svg+xml', png, root), undefined);
  assert.equal(saveImage('ab12cd34', 'image/png', '<script>', root), undefined);
  assert.equal(saveImage('ab12cd34', 'image/png', '', root), undefined);
  assert.equal(saveImage('../../etc', 'image/png', png, root), undefined);
  const ref = saveImage('ab12cd34', 'image/png', png, root)!;
  for (const [agent, id] of [['..', ref.id], ['ab12cd34', '../ab12cd34/' + ref.id], ['ab12cd34', '..'], ['ab12cd34/..', ref.id], [undefined, ref.id], ['ab12cd34', 7]])
    assert.equal(readImage(agent, id, root), undefined, `${agent} ${id}`);
});

test("a tool's pictures become references, and leave its text", () => {
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Took a screenshot.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }] } };
  const [kept] = toEvents(result, (mime, data) => saveImage('ab12cd34', mime, data, root));
  assert.equal(kept.type, 'tool_result');
  assert.ok(kept.type === 'tool_result' && kept.output === 'Took a screenshot.' && kept.images?.length === 1 && kept.images[0].mime === 'image/png');
  assert.ok(!JSON.stringify(kept).includes(png.slice(0, 40)), 'the picture itself is not in the event');
  // With nowhere to keep them, the text says there was one, as before.
  const [plain] = toEvents(result);
  assert.ok(plain.type === 'tool_result' && plain.output === 'Took a screenshot.\n[image]' && !plain.images);
});
