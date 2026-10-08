import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invitationIn, inviteLink } from '../../app/src/invite.ts';

const invite = {
  type: 'invite' as const,
  phoneId: 'ab12cd34',
  secret: 'a'.repeat(32),
  deviceId: 'b'.repeat(32),
  relayKey: 'c'.repeat(64),
  address: 'ws://192.0.2.7:7860',
  relay: 'wss://relay.example',
  name: "Sam's Toto & co",
  expires: 0,
};
const params = (link: string) => Object.fromEntries(new URL(link).searchParams);

test('an invitation survives the trip through a link', () => {
  const link = inviteLink(invite);
  assert.ok(link.startsWith('toto://join?'));
  const { type, expires, ...sent } = invite;
  assert.deepEqual(invitationIn(params(link)), sent);
  // No relay is a real setting, and must come through as none.
  assert.equal(invitationIn(params(inviteLink({ ...invite, relay: '' })))?.relay, '');
});

test('a link that is not a whole, well-formed invitation is not one', () => {
  const good = params(inviteLink(invite));
  for (const [field, bad] of [
    ['a', 'https://evil.example'],
    ['a', 'javascript:alert(1)'],
    ['r', 'http://evil.example'],
    ['d', 'not-hex'],
    ['k', 'c'.repeat(63)],
    ['i', '../../etc'],
    ['s', ''],
    ['n', '   '],
    ['n', 'x'.repeat(301)],
  ])
    assert.equal(invitationIn({ ...good, [field]: bad }), undefined, `${field}=${bad.slice(0, 20)}`);
  const { s, ...missing } = good;
  assert.equal(invitationIn(missing), undefined);
  assert.equal(invitationIn({ ...good, a: ['ws://a', 'ws://b'] }), undefined);
});
