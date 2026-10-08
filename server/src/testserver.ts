import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { keysFromToken, session } from './secure.ts';

export type Line = { said: any[]; send: (m: object) => void; next: (type: string) => Promise<any>; ended: Promise<'refused' | 'closed'> };

/** A real server, with its token `owner-token`, to be talked to as phones. It is stopped when the test file ends. */
export function startServer(env: Record<string, string> = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn(process.execPath, [new URL('./index.ts', import.meta.url).pathname], {
    env: { ...process.env, TOTO_PORT: String(port), TOTO_TOKEN: 'owner-token', TOTO_DATA_DIR: mkdtempSync(join(tmpdir(), 'toto-test-')), TOTO_RELAY_URL: '', ...env },
    stdio: 'ignore',
  });
  after(() => server.kill());

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
  return { port, dial, soon };
}
