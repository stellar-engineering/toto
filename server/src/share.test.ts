import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { keysFromToken, session } from './secure.ts';

// A real server, talked to as the owner's phone and as a phone it shares with.
const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [new URL('./index.ts', import.meta.url).pathname], {
  env: { ...process.env, TOTO_PORT: String(port), TOTO_TOKEN: 'owner-token', TOTO_DATA_DIR: mkdtempSync(join(tmpdir(), 'toto-share-')), TOTO_RELAY_URL: '' },
  stdio: 'ignore',
});
after(() => server.kill());

type Line = { said: any[]; send: (m: object) => void; next: (type: string) => Promise<any>; ended: Promise<'refused' | 'closed'> };

/** Opens a line with the device's token, or as phone `p` with a secret of its own. */
async function dial(secret: string, p?: string): Promise<Line> {
  for (let tries = 0; ; tries++) {
    try {
      return await new Promise<Line>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const nonce = randomBytes(16).toString('hex');
        const said: any[] = [];
        const waiting: { type: string; got: (m: any) => void }[] = [];
        let s: ReturnType<typeof session>;
        let end: (how: 'refused' | 'closed') => void;
        const line: Line = {
          said,
          send: (m) => ws.send(JSON.stringify({ t: 'data', b: s.seal(JSON.stringify(m)) })),
          next: (type) => new Promise((got) => waiting.push({ type, got })),
          ended: new Promise((r) => (end = r)),
        };
        ws.onerror = () => reject(new Error('not up yet'));
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', n: nonce, p }));
        ws.onclose = () => end('closed');
        ws.onmessage = ({ data }) => {
          const f = JSON.parse(data);
          if (f.t === 'refused') return end('refused');
          if (f.t === 'hello') {
            s = session(keysFromToken(secret).psk, 'client', nonce, f.n);
            return resolve(line);
          }
          const m = JSON.parse(s.open(f.b));
          said.push(m);
          const i = waiting.findIndex((w) => w.type === m.type);
          if (i >= 0) waiting.splice(i, 1)[0].got(m);
        };
      });
    } catch (err) {
      if (tries > 40) throw err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
const soon = <T,>(p: Promise<T>) => Promise.race([p, new Promise<'nothing'>((r) => setTimeout(() => r('nothing'), 1500))]);

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
