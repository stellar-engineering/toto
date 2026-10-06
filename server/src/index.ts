import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AgentEvent, ClientMessage } from '../../protocol.ts';
import { startClaude } from './claude.ts';

const port = Number(process.env.TOTO_PORT ?? 7860);
const cwd = process.env.TOTO_PROJECT_DIR ?? process.cwd();
// ponytail: one shared token stands in for auth until M2 pairing exchanges real keys.
const token = process.env.TOTO_TOKEN ?? randomBytes(16).toString('hex');

const sha = (s: string) => createHash('sha256').update(s).digest();
const authorised = (url = '') =>
  timingSafeEqual(sha(new URL(url, 'http://x').searchParams.get('token') ?? ''), sha(token));

const wss = new WebSocketServer({ port, verifyClient: ({ req }: { req: IncomingMessage }) => authorised(req.url) });

// ponytail: one agent, and its history lives in memory, unbounded and lost on restart.
// Becomes a per-agent store on disk when M1 adds multiple agents.
const log: AgentEvent[] = [];
const emit = (e: AgentEvent) => {
  log.push(e);
  const data = JSON.stringify(e);
  for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(data);
};

// ponytail: if claude dies the next prompt starts a fresh conversation. Resume by session id in M1.
let agent: ReturnType<typeof startClaude> | undefined;

wss.on('connection', (ws) => {
  for (const e of log) ws.send(JSON.stringify(e));
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.type !== 'prompt' || typeof msg.text !== 'string' || !msg.text.trim()) return;
    emit({ type: 'user', text: msg.text });
    agent ??= startClaude(cwd, emit, () => (agent = undefined));
    agent.send(msg.text);
  });
});

wss.on('listening', () => {
  console.log(`toto-server on :${port}, project ${cwd}`);
  if (!process.env.TOTO_TOKEN) console.log(`token: ${token}`);
});
