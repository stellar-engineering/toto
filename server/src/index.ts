import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Agent, AgentEvent, ClientMessage, Mode, Project, ServerMessage } from '../../protocol.ts';
import { startClaude } from './claude.ts';
import { addWorktree, createProject, dataDir, deviceKey, openApprovals } from './projects.ts';

const port = Number(process.env.TOTO_PORT ?? 7860);
// ponytail: one shared token stands in for auth until M2 pairing exchanges real keys.
const token = process.env.TOTO_TOKEN ?? randomBytes(16).toString('hex');

type ProjectRecord = Project & { user?: string; dir: string };
type AgentRecord = Agent & { cwd: string; sessionId?: string };

// --- State on disk: one JSON file for projects and agents, one append-only log per agent.
const logDir = join(dataDir, 'logs');
mkdirSync(logDir, { recursive: true });
const stateFile = join(dataDir, 'state.json');
const state: { projects: ProjectRecord[]; agents: AgentRecord[] } = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { projects: [], agents: [] };
const logFile = (agentId: string) => join(logDir, `${agentId}.jsonl`);
// ponytail: every log is held in memory and replayed whole on connect. Page it when logs get long.
const logs = new Map<string, AgentEvent[]>(
  state.agents.map((a) => [
    a.id,
    existsSync(logFile(a.id))
      ? readFileSync(logFile(a.id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [],
  ]),
);
const running = new Map<string, ReturnType<typeof startClaude>>();
const sshKey = await deviceKey();
const snapshot = (): ServerMessage => ({ type: 'state', ...state, sshKey });

const isMode = (m: unknown): m is Mode => m === 'ask' || m === 'auto';
const isName = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= 60;
const newId = () => randomBytes(4).toString('hex');

const sha = (s: string) => createHash('sha256').update(s).digest();
const authorised = (url = '') =>
  timingSafeEqual(sha(new URL(url, 'http://x').searchParams.get('token') ?? ''), sha(token));

const wss = new WebSocketServer({ port, verifyClient: ({ req }: { req: IncomingMessage }) => authorised(req.url) });

const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));
const broadcast = (msg: ServerMessage) => {
  for (const client of wss.clients) if (client.readyState === client.OPEN) send(client, msg);
};

/** Persists projects and agents, then tells every client. */
const commit = () => {
  writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2));
  renameSync(stateFile + '.tmp', stateFile); // atomic, so a crash mid-write cannot corrupt it
  broadcast(snapshot());
};

const emit = (agent: AgentRecord, event: AgentEvent) => {
  logs.get(agent.id)!.push(event);
  appendFileSync(logFile(agent.id), JSON.stringify(event) + '\n');
  broadcast({ type: 'event', agentId: agent.id, event });
  if (event.type === 'approval_request' && agent.mode === 'auto') running.get(agent.id)?.resolve(event.id, true);
};

// Approvals left open by a previous run have nobody to answer to any more.
for (const agent of state.agents)
  for (const id of openApprovals(logs.get(agent.id)!)) emit(agent, { type: 'approval_resolved', id, allowed: false });

// ponytail: agents are direct children, so a server restart ends any turn in flight;
// the conversation itself resumes from its session id on the next prompt.
const start = (agent: AgentRecord) => {
  const project = state.projects.find((p) => p.id === agent.projectId)!;
  const proc = startClaude({
    cwd: agent.cwd,
    user: project.user,
    sessionId: agent.sessionId,
    onEvent: (e) => emit(agent, e),
    onSession: (id) => {
      agent.sessionId = id;
      commit();
    },
    onExit: () => running.delete(agent.id),
  });
  running.set(agent.id, proc);
  return proc;
};

async function handle(msg: ClientMessage) {
  const agent = 'agentId' in msg ? state.agents.find((a) => a.id === msg.agentId) : undefined;
  switch (msg?.type) {
    case 'create_project': {
      if (!isName(msg.name) || typeof msg.repo !== 'string') throw new Error('A project needs a name and a repository.');
      const id = newId();
      const { user, dir } = await createProject(id, msg.repo.trim());
      state.projects.push({ id, name: msg.name.trim(), repo: msg.repo.trim(), user, dir });
      return commit();
    }
    case 'create_agent': {
      const project = state.projects.find((p) => p.id === msg.projectId);
      if (!project || !isName(msg.name) || !isMode(msg.mode)) throw new Error('An agent needs a project and a name.');
      const id = newId();
      const cwd = msg.worktree === true ? await addWorktree(project, id) : project.dir;
      logs.set(id, []);
      state.agents.push({ id, projectId: project.id, name: msg.name.trim(), mode: msg.mode, worktree: msg.worktree === true, cwd });
      return commit();
    }
    case 'prompt':
      if (!agent || typeof msg.text !== 'string' || !msg.text.trim()) return;
      emit(agent, { type: 'user', text: msg.text });
      return void (running.get(agent.id) ?? start(agent)).send(msg.text);
    case 'approve':
      if (agent && typeof msg.id === 'string') running.get(agent.id)?.resolve(msg.id, msg.allow === true);
      return;
    case 'set_mode':
      if (!agent || !isMode(msg.mode)) return;
      agent.mode = msg.mode;
      commit();
      if (agent.mode === 'auto')
        for (const id of openApprovals(logs.get(agent.id)!)) running.get(agent.id)?.resolve(id, true);
      return;
  }
}

wss.on('connection', (ws) => {
  send(ws, snapshot());
  for (const [agentId, log] of logs) for (const event of log) send(ws, { type: 'event', agentId, event });
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    handle(msg).catch((err) => send(ws, { type: 'failed', message: err.message }));
  });
});

wss.on('listening', () => {
  console.log(`toto-server on :${port}, data in ${dataDir}`);
  if (!process.env.TOTO_TOKEN) console.log(`token: ${token}`);
});
