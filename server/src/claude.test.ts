import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '../../protocol.ts';
import { startClaude, toEvents } from './claude.ts';

test('maps claude stream-json onto common events', () => {
  assert.deepEqual(
    toEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }),
    [
      { type: 'text', text: 'hi' },
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ],
  );
  assert.deepEqual(
    toEvents({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a' }], is_error: true }] },
    }),
    [{ type: 'tool_result', id: 't1', output: 'a', isError: true }],
  );
  assert.deepEqual(toEvents({ type: 'result', is_error: false }), [{ type: 'done', isError: false }]);
});

test('ignores noise', () => {
  assert.deepEqual(toEvents(null), []);
  assert.deepEqual(toEvents({ type: 'system', subtype: 'init' }), []);
  assert.deepEqual(toEvents({ type: 'user', message: { content: 'plain prompt echo' } }), []);
});

test('relays approvals to claude and back', async () => {
  const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
  chmodSync(fake, 0o755);
  process.env.TOTO_CLAUDE_BIN = fake;

  const events: AgentEvent[] = [];
  let agent!: ReturnType<typeof startClaude>;
  await new Promise<void>((done) => {
    agent = startClaude(
      process.cwd(),
      (e) => {
        events.push(e);
        if (e.type === 'approval_request') {
          agent.resolve(e.id, e.id === 't1'); // allow the first, deny the second
          agent.resolve(e.id, true); // a repeat answer must be ignored
        }
        if (e.type === 'done') done();
      },
      () => {},
    );
    agent.send('go');
  });
  agent.stop();

  assert.deepEqual(
    events.filter((e) => e.type !== 'tool_call'),
    [
      { type: 'approval_request', id: 't1', name: 'Bash', input: { n: 1 } },
      { type: 'approval_resolved', id: 't1', allowed: true },
      { type: 'approval_request', id: 't2', name: 'Bash', input: { n: 2 } },
      { type: 'approval_resolved', id: 't2', allowed: false },
      { type: 'text', text: 'r1:allow r2:deny' },
      { type: 'done', isError: false },
    ],
  );
});
