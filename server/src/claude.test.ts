import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '../../protocol.ts';
import { startClaude, toEvents } from './claude.ts';
import { execFileSync } from 'node:child_process';
import { envFile, openApprovals } from './projects.ts';
import { readFrame, tmuxKey } from './terminal.ts';
import { deadTokens, isPushToken, pushMessage } from './push.ts';

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
    agent = startClaude({
      cwd: process.cwd(),
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'approval_request' && e.id === 't1') {
          assert.deepEqual(openApprovals(events), ['t1']);
          agent.resolve(e.id, true);
          agent.resolve(e.id, false); // a repeat answer must be ignored
        }
        if (e.type === 'approval_request' && e.id === 't2') agent.resolve(e.id, false);
        if (e.type === 'done') agent.stop();
      },
      onSession: () => {},
      onExit: done,
    });
    agent.send('go');
  });
  assert.deepEqual(openApprovals(events), []);

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

test('reads a terminal frame: cursor within scrollback, unused rows dropped', () => {
  // Two lines of scrollback, then a 4-row pane with text on its first two rows and the cursor on the second.
  assert.deepEqual(readFrame('2 1 4\nold1\nold2\n$ ls\n$ \n\n\n'), { screen: 'old1\nold2\n$ ls\n$ ', cursor: { row: 3, col: 2 } });
  // A cursor sitting below the text keeps the blank rows above it.
  assert.deepEqual(readFrame('0 2 3\na\n\n\n'), { screen: 'a\n\n', cursor: { row: 2, col: 0 } });
});

test('credentials survive the trip through a shell file, whatever they contain', () => {
  const nasty = `it's a "token" with $HOME \`cmd\` and \\ slashes`;
  const file = envFile({ ANTHROPIC_API_KEY: nasty, CLAUDE_CODE_OAUTH_TOKEN: '', OTHER: 'not a credential' });
  assert.ok(!file.includes('OTHER') && !file.includes('CLAUDE_CODE_OAUTH_TOKEN'), 'only credentials that are set');
  // Source it the way agents do, and read the value back.
  const got = execFileSync('sh', ['-c', `${file} printf %s "$ANTHROPIC_API_KEY"`]).toString();
  assert.equal(got, nasty);
});

test('push: says nothing about the work, and forgets phones that have gone', () => {
  const message = pushMessage(['ExponentPushToken[a]'], 'approval', 'ab12cd34');
  assert.deepEqual(message.data, { agentId: 'ab12cd34' });
  assert.equal(message.body, 'An agent is waiting for your go-ahead.');
  assert.equal(message.priority, 'high');
  assert.equal(pushMessage([], 'done', 'x').priority, 'default');

  assert.ok(isPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]') && isPushToken('ExpoPushToken[a-b_c]'));
  assert.ok(!isPushToken('ExponentPushToken[]') && !isPushToken('https://evil.example') && !isPushToken(7));

  const answer = { data: [{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'error', details: { error: 'MessageRateExceeded' } }] };
  assert.deepEqual(deadTokens(['a', 'b', 'c'], answer), ['b']);
  assert.deepEqual(deadTokens(['a'], { errors: [{ code: 'X' }] }), []);
});

test('terminal keys: only known names reach tmux', () => {
  assert.equal(tmuxKey('enter'), 'Enter');
  assert.equal(tmuxKey('pageup'), 'PPage');
  assert.equal(tmuxKey('ctrl-c'), 'C-c');
  for (const bad of ['ctrl-C', 'ctrl-cc', 'ctrl-;', 'Enter', '-t other', 'constructor', '', undefined, 5]) assert.equal(tmuxKey(bad), undefined, String(bad));
});
