import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toEvents } from './claude.ts';

const line = (o: unknown) => JSON.stringify(o);

test('maps claude stream-json onto common events', () => {
  assert.deepEqual(
    toEvents(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'hi' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      }),
    ),
    [
      { type: 'text', text: 'hi' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ],
  );
  assert.deepEqual(
    toEvents(
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a' }], is_error: true }] },
      }),
    ),
    [{ type: 'tool_result', id: 't1', output: 'a', isError: true }],
  );
  assert.deepEqual(toEvents(line({ type: 'result', is_error: false })), [{ type: 'done', isError: false }]);
});

test('ignores noise', () => {
  assert.deepEqual(toEvents('not json'), []);
  assert.deepEqual(toEvents('null'), []);
  assert.deepEqual(toEvents(line({ type: 'system', subtype: 'init' })), []);
  assert.deepEqual(toEvents(line({ type: 'user', message: { content: 'plain prompt echo' } })), []);
});
