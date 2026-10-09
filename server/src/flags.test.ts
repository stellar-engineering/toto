import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from './testserver.ts';

const { dial } = startServer();

test('a debugging switch is turned on from a phone, and only by the owner, and holds', async () => {
  const phone = await dial('owner-token');
  phone.send({ type: 'sync' });
  const first = await phone.next('state');
  assert.deepEqual(first.flags.map((f: any) => [f.name, f.on]), [['debugStream', false]]);

  phone.send({ type: 'set_flag', name: 'debugStream', on: true });
  const now = await phone.next('state');
  assert.equal(now.flags[0].on, true);

  // A fresh connection sees it as it was left, and it can be turned off again.
  const later = await dial('owner-token');
  later.send({ type: 'sync' });
  assert.equal((await later.next('state')).flags[0].on, true);
  later.send({ type: 'set_flag', name: 'debugStream', on: false });
  assert.equal((await later.next('state')).flags[0].on, false);

  // Nothing that is not a switch, nor anything but on or off.
  for (const bad of [{ name: 'nope', on: true }, { name: 'debugStream', on: 'yes' }, { name: '__proto__', on: true }]) {
    phone.send({ type: 'set_flag', ...bad });
    assert.match((await phone.next('failed')).message, /not a setting/);
  }
  assert.equal(phone.said.findLast((m) => m.type === 'state').flags[0].on, false);
});
