import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { keysFromToken } from './secure.ts';
import { startServer } from './testserver.ts';

const { port, dial, soon } = startServer();

test('a Toto is shared by a one-time invitation, and the owner can take it back', async () => {
  const owner = await dial('owner-token');
  owner.send({ type: 'sync' });
  assert.equal((await owner.next('state')).owner, true);

  owner.send({ type: 'share', name: 'iPhone' });
  const invite = await owner.next('invite');
  assert.equal(invite.deviceId, keysFromToken('owner-token').deviceId);
  assert.notEqual(invite.secret, 'owner-token');

  // Someone holding only the invitation is told nothing, and may ask for nothing but a key.
  const nosy = await dial(invite.secret, invite.phoneId);
  nosy.send({ type: 'sync' });
  assert.equal(await soon(nosy.ended), 'closed');
  assert.deepEqual(nosy.said, []);

  // Two phones scan the same code. One gets a key; the invitation is then spent for the other.
  const [first, second] = [await dial(invite.secret, invite.phoneId), await dial(invite.secret, invite.phoneId)];
  first.send({ type: 'join' });
  const { secret } = await first.next('joined');
  assert.ok(secret && secret !== invite.secret);
  second.send({ type: 'join' });
  assert.equal(await soon(second.ended), 'closed');
  assert.deepEqual(second.said, []);
  // Nor does the code open anything afterwards.
  const late = await dial(invite.secret, invite.phoneId);
  late.send({ type: 'sync' });
  assert.equal(await soon(late.ended), 'closed');
  assert.deepEqual(late.said, []);

  // The phone's own key works, it is told it is not the owner, and it cannot share or remove.
  const guest = await dial(secret, invite.phoneId);
  guest.send({ type: 'sync' });
  const seen = await guest.next('state');
  assert.equal(seen.owner, false);
  assert.deepEqual(seen.phones.map((p: any) => [p.name, p.pending]), [['iPhone', false]]);
  assert.ok(!JSON.stringify(seen).includes(secret), 'no key is ever sent in the state');
  guest.send({ type: 'share', name: 'A friend' });
  assert.match((await guest.next('failed')).message, /Only the phone that set this Toto up/);
  guest.send({ type: 'revoke', phoneId: invite.phoneId });
  assert.match((await guest.next('failed')).message, /Only the phone that set this Toto up/);

  // Taken away: the open line is closed at once, and the key is refused from then on.
  owner.send({ type: 'revoke', phoneId: invite.phoneId });
  assert.equal(await soon(guest.ended), 'closed');
  assert.equal(await soon(turnedAway(invite.phoneId)), 'refused');
  // The owner is untouched.
  owner.send({ type: 'ping' });
  assert.ok(await owner.next('pong'));
});

/** How a dial as phone `p` ends when the device will not even begin a handshake with it. */
function turnedAway(p: string) {
  return new Promise<'refused' | 'closed'>((end) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', n: randomBytes(16).toString('hex'), p }));
    ws.onmessage = ({ data }) => JSON.parse(data).t === 'refused' && end('refused');
    ws.onclose = () => end('closed');
  });
}
