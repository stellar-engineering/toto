import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { startServer } from './testserver.ts';

// A real server with the stand-in for Claude, whose turn lasts until its two tool calls are answered:
// a turn that can be held open, to say things to while it is.
const fake = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
chmodSync(fake, 0o755);
// The server only clones from an https or ssh address, so a local repository stands in for one by
// git's own rewriting of the address.
const origin = mkdtempSync(join(tmpdir(), 'toto-origin-'));
execFileSync('git', ['init', '-q', origin]);
execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'start']);
const { dial } = startServer({ TOTO_CLAUDE_BIN: fake, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://example.test/origin.git' });

/** Waits for something to become true, for a few seconds, and says what it was waiting for if it does not. */
async function eventually(what: string, ok: () => boolean) {
  for (let tries = 0; tries < 100 && !ok(); tries++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(ok(), what);
}

test('a message sent mid-turn can wait for the turn to end, be taken back, or go in at once', { timeout: 60_000 }, async () => {
  const phone = await dial('owner-token');
  phone.send({ type: 'sync' });
  await phone.next('state');
  /** The latest state that has what is asked for, whenever it arrives. */
  const state = async (has: (s: any) => boolean) => {
    for (let tries = 0; tries < 200; tries++) {
      const found = phone.said.findLast((m) => m.type === 'state' && has(m));
      if (found) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the state never had it: ' + JSON.stringify(phone.said.filter((m) => m.type === 'failed')));
  };
  phone.send({ type: 'create_project', name: 'p', repo: 'https://example.test/origin.git' });
  const project = (await state((s) => s.projects.length)).projects[0];
  phone.send({ type: 'create_agent', projectId: project.id, name: 'a', harness: 'claude', mode: 'ask', worktree: false });
  const agent = (await state((s) => s.agents.length)).agents[0];
  const said = (what: string) => phone.said.filter((m) => m.type === 'event' && m.event.type === 'user' && m.event.text === what).length;
  const questions = () => phone.said.filter((m) => m.type === 'event' && m.event.type === 'approval_request').length;

  // Idle: `later` changes nothing, and it goes in at once.
  phone.send({ type: 'prompt', agentId: agent.id, text: 'first', later: true });
  await eventually('it asks about two tool calls', () => questions() >= 2);
  assert.equal(said('first'), 1);

  // Mid-turn it waits, and is told so; the agent has not heard it.
  phone.send({ type: 'prompt', agentId: agent.id, text: 'second', later: true });
  assert.deepEqual((await phone.next('queue')).items, [{ text: 'second' }]);
  phone.send({ type: 'prompt', agentId: agent.id, text: 'third', later: true });
  assert.equal((await phone.next('queue')).items.length, 2);
  assert.equal(said('second'), 0);

  // Taken back, it is gone from the line.
  phone.send({ type: 'unqueue', agentId: agent.id, index: 1 });
  assert.deepEqual((await phone.next('queue')).items, [{ text: 'second' }]);
  // Taking back one that is not there is not an answer worth sending.
  const told = phone.said.filter((m) => m.type === 'queue').length;
  phone.send({ type: 'unqueue', agentId: agent.id, index: 7 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(phone.said.filter((m) => m.type === 'queue').length, told);

  // A waiting message can be sent in at once, to steer: out of the line and into the turn.
  phone.send({ type: 'prompt', agentId: agent.id, text: 'fourth', later: true });
  assert.deepEqual((await phone.next('queue')).items, [{ text: 'second' }, { text: 'fourth' }]);
  phone.send({ type: 'steer', agentId: agent.id, index: 1 });
  assert.deepEqual((await phone.next('queue')).items, [{ text: 'second' }]);
  await eventually('a waiting message sent now goes straight in', () => said('fourth') === 1);
  assert.equal(said('second'), 0);

  // Without `later`, mid-turn, it steers: it goes straight in.
  phone.send({ type: 'prompt', agentId: agent.id, text: 'steer' });
  await eventually('a steering message goes straight in', () => said('steer') === 1);
  assert.equal(said('second'), 0);

  // When the turn ends, what was waiting is said, in its turn, and the line is empty again.
  for (const id of ['t1', 't2']) phone.send({ type: 'approve', agentId: agent.id, id, allow: true });
  await eventually('what waited is said when the turn ends', () => said('second') === 1);
  assert.deepEqual(phone.said.findLast((m) => m.type === 'queue').items, []);
});
