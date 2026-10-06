import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AgentEvent, ClientMessage, Mode, ServerMessage } from '../../protocol.ts';
import { startClaude } from './claude.ts';

const port = Number(process.env.TOTO_PORT ?? 7860);
const cwd = process.env.TOTO_PROJECT_DIR ?? process.cwd();
// ponytail: one shared token stands in for auth until M2 pairing exchanges real keys.
const token = process.env.TOTO_TOKEN ?? randomBytes(16).toString('hex');

const sha = (s: string) => createHash('sha256').update(s).digest();
const authorised = (url = '') =>
  timingSafeEqual(sha(new URL(url, 'http://x').searchParams.get('token') ?? ''), sha(token));

const wss = new WebSocketServer({ port, verifyClient: ({ req }: { req: IncomingMessage }) => authorised(req.url) });

const broadcast = (msg: ServerMessage) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(data);
};

// ponytail: one agent, and its history lives in memory, unbounded and lost on restart.
// Becomes a per-agent store on disk when M1 adds multiple agents.
const log: AgentEvent[] = [];
// ponytail: if claude dies the next prompt starts a fresh conversation. Resume by session id in M1.
let agent: ReturnType<typeof startClaude> | undefined;
let mode: Mode = 'ask';
const open = new Set<string>(); // approvals waiting on the user

const emit = (e: AgentEvent) => {
  log.push(e);
  broadcast(e);
  if (e.type === 'approval_resolved') open.delete(e.id);
  if (e.type === 'approval_request') {
    if (mode === 'auto') agent?.resolve(e.id, true);
    else open.add(e.id);
  }
};

wss.on('connection', (ws) => {
  for (const e of log) ws.send(JSON.stringify(e));
  ws.send(JSON.stringify({ type: 'mode', mode } satisfies ServerMessage));
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg?.type) {
      case 'prompt':
        if (typeof msg.text !== 'string' || !msg.text.trim()) return;
        emit({ type: 'user', text: msg.text });
        agent ??= startClaude(cwd, emit, () => (agent = undefined));
        agent.send(msg.text);
        return;
      case 'approve':
        if (typeof msg.id === 'string') agent?.resolve(msg.id, msg.allow === true);
        return;
      case 'set_mode':
        if (msg.mode !== 'ask' && msg.mode !== 'auto') return;
        mode = msg.mode;
        broadcast({ type: 'mode', mode });
        if (mode === 'auto') for (const id of [...open]) agent?.resolve(id, true);
        return;
    }
  });
});

wss.on('listening', () => {
  console.log(`toto-server on :${port}, project ${cwd}`);
  if (!process.env.TOTO_TOKEN) console.log(`token: ${token}`);
});
