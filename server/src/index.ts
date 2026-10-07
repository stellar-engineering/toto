import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Agent, AgentEvent, ClientMessage, Identity, Mode, Project, ServerMessage } from '../../protocol.ts';
import { type Screen, isTermKey, killTerminal, openTerminal, sendToTerminal, watchTerminal } from './terminal.ts';
import { startClaude } from './claude.ts';
import { type PushKind, isPushToken, push } from './push.ts';
import { type Frame, NONCE_BYTES, keysFromToken, session } from './secure.ts';
import {
  addWorktree,
  applyIdentity,
  createProject,
  dataDir,
  deviceKey,
  installEnv,
  openApprovals,
  removeProject,
  removeWorktree,
  setLan,
} from './projects.ts';

const port = Number(process.env.TOTO_PORT ?? 7860);
// ponytail: one shared token stands in for auth until M2 pairing exchanges real keys.
const token = process.env.TOTO_TOKEN ?? randomBytes(16).toString('hex');
const { psk, deviceId, relayKey } = keysFromToken(token);
// Where clients away from the local network reach this device. Unset means local network only.
const relayUrl = process.env.TOTO_RELAY_URL;

/** A connected client that has proved it holds the key. */
type Client = { send: (msg: ServerMessage) => void };
const clients = new Set<Client>();

type ProjectRecord = Project & { user?: string; dir: string };
type AgentRecord = Agent & { cwd: string; sessionId?: string };

// --- State on disk: one JSON file for projects and agents, one append-only log per agent.
const logDir = join(dataDir, 'logs');
mkdirSync(logDir, { recursive: true });
const stateFile = join(dataDir, 'state.json');
const state: { projects: ProjectRecord[]; agents: AgentRecord[]; identity: Identity; pushTokens: string[] } = {
  projects: [],
  agents: [],
  pushTokens: [],
  // A placeholder so commits never fail for want of an author; the app asks for the real one.
  identity: { name: 'Toto', email: `toto@${hostname()}` },
  ...(existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}),
};
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
for (const a of state.agents) a.harness ??= 'claude'; // agents saved before there was a choice
const running = new Map<string, ReturnType<typeof startClaude>>();
// Terminal agents someone has open: who is watching, and how to stop.
const terminals = new Map<string, { viewers: Set<Client>; screen?: Screen; stop: () => void }>();
const sshKey = await deviceKey();
// Credentials change by editing the server's environment and restarting, so this is where projects catch up.
await Promise.all(state.projects.map((p) => installEnv(p.user).catch((err) => console.error(`credentials for ${p.name}: ${err.message}`))));
// Firewall rules do not survive a reboot, so every start puts each project back where it should be.
// ponytail: if something else wipes the rules while we run, they stay gone until the next start.
for (const p of state.projects) {
  if (!p.user) continue;
  p.lan ??= false;
  await setLan(p.user, p.lan).catch((err) => console.error(`FIREWALL NOT APPLIED for ${p.name}: ${err.message}`));
}
const snapshot = (): ServerMessage => ({ type: 'state', projects: state.projects, agents: state.agents, identity: state.identity, sshKey });

const isMode = (m: unknown): m is Mode => m === 'ask' || m === 'auto';
const isName = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && s.length <= 60;
// One line, and not something git could take for an option.
const isGitValue = (s: unknown): s is string => typeof s === 'string' && /^[^-\s][^\n\r]{0,99}$/.test(s);
const newId = () => randomBytes(4).toString('hex');

const send = (client: Client, msg: ServerMessage) => client.send(msg);
const broadcast = (msg: ServerMessage) => {
  for (const client of clients) send(client, msg);
};

const save = () => {
  writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2));
  renameSync(stateFile + '.tmp', stateFile); // atomic, so a crash mid-write cannot corrupt it
};

/** Persists projects and agents, then tells every client. */
const commit = () => {
  save();
  broadcast(snapshot());
};

/** Tells every registered phone, and forgets any that have since uninstalled. */
const notify = (kind: PushKind, agent: AgentRecord) =>
  void push(state.pushTokens, kind, agent.id).then((dead) => {
    if (!dead.length) return;
    state.pushTokens = state.pushTokens.filter((t) => !dead.includes(t));
    save();
  });

const emit = (agent: AgentRecord, event: AgentEvent) => {
  if (!logs.has(agent.id)) return; // deleted while its process was still winding down
  logs.get(agent.id)!.push(event);
  appendFileSync(logFile(agent.id), JSON.stringify(event) + '\n');
  broadcast({ type: 'event', agentId: agent.id, event });
  if (event.type === 'approval_request') {
    if (agent.mode === 'auto') running.get(agent.id)?.resolve(event.id, true);
    else notify('approval', agent);
  }
  if (event.type === 'done') notify('done', agent);
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
      if (logs.has(agent.id)) commit();
    },
    onExit: () => running.delete(agent.id),
  });
  running.set(agent.id, proc);
  return proc;
};

const where = (agent: AgentRecord) => ({
  user: state.projects.find((p) => p.id === agent.projectId)?.user,
  cwd: agent.cwd,
  agentId: agent.id,
});

const unwatch = (agentId: string, ws: Client) => {
  const term = terminals.get(agentId);
  if (!term?.viewers.delete(ws) || term.viewers.size) return;
  term.stop();
  terminals.delete(agentId);
};

/** Stops an agent and forgets it. The caller removes it from `state.agents`. */
const forget = (agent: AgentRecord) => {
  terminals.get(agent.id)?.stop();
  terminals.delete(agent.id);
  if (agent.harness === 'terminal') killTerminal(where(agent));
  running.get(agent.id)?.stop();
  logs.delete(agent.id);
  rmSync(logFile(agent.id), { force: true });
};

async function handle(msg: ClientMessage, ws: Client) {
  const agent = 'agentId' in msg ? state.agents.find((a) => a.id === msg.agentId) : undefined;
  switch (msg?.type) {
    case 'sync':
      send(ws, snapshot());
      for (const [agentId, log] of logs) for (const event of log) send(ws, { type: 'event', agentId, event });
      return send(ws, { type: 'synced' });
    case 'register_push':
      if (!isPushToken(msg.token) || state.pushTokens.includes(msg.token)) return;
      // The newest few: a phone gets a fresh token now and then, and old ones would otherwise pile up.
      state.pushTokens = [...state.pushTokens, msg.token].slice(-10);
      return save();
    case 'create_project': {
      if (!isName(msg.name) || typeof msg.repo !== 'string') throw new Error('A project needs a name and a repository.');
      const id = newId();
      const { user, dir } = await createProject(id, msg.repo.trim(), state.identity);
      // A new project user starts off the local network; toto-priv saw to that when it made the user.
      state.projects.push({ id, name: msg.name.trim(), repo: msg.repo.trim(), user, dir, lan: user ? false : undefined });
      return commit();
    }
    case 'set_identity': {
      if (!isGitValue(msg.name) || !isGitValue(msg.email) || !msg.email.includes('@'))
        throw new Error('Enter a name and an email address.');
      state.identity = { name: msg.name.trim(), email: msg.email.trim() };
      commit();
      for (const project of state.projects) await applyIdentity(project, state.identity);
      return;
    }
    case 'set_lan': {
      const project = state.projects.find((p) => p.id === msg.projectId);
      if (!project?.user) return;
      // Change the firewall first, so the app never shows a state the device is not in.
      await setLan(project.user, msg.allow === true);
      project.lan = msg.allow === true;
      return commit();
    }
    case 'delete_project': {
      const project = state.projects.find((p) => p.id === msg.projectId);
      if (!project) return;
      // Out of state first, so nothing new can start in it while its files go.
      state.agents.filter((a) => a.projectId === project.id).forEach(forget);
      state.agents = state.agents.filter((a) => a.projectId !== project.id);
      state.projects = state.projects.filter((p) => p !== project);
      commit();
      return removeProject(project.id, project.user);
    }
    case 'delete_agent': {
      if (!agent) return;
      forget(agent);
      state.agents = state.agents.filter((a) => a !== agent);
      commit();
      const project = state.projects.find((p) => p.id === agent.projectId);
      if (agent.worktree && project) await removeWorktree(project, agent.cwd);
      return;
    }
    case 'create_agent': {
      const project = state.projects.find((p) => p.id === msg.projectId);
      if (!project || !isName(msg.name) || !isMode(msg.mode)) throw new Error('An agent needs a project and a name.');
      const harness = msg.harness === 'terminal' ? 'terminal' : 'claude';
      const id = newId();
      const cwd = msg.worktree === true ? await addWorktree(project, id) : project.dir;
      logs.set(id, []);
      state.agents.push({ id, projectId: project.id, name: msg.name.trim(), harness, mode: msg.mode, worktree: msg.worktree === true, cwd });
      return commit();
    }
    case 'term_open': {
      if (agent?.harness !== 'terminal') return;
      const size = (n: unknown, max: number) => Math.min(max, Math.max(10, Math.floor(Number(n)) || 10));
      await openTerminal(where(agent), size(msg.cols, 300), size(msg.rows, 100));
      let term = terminals.get(agent.id);
      if (!term) {
        term = {
          viewers: new Set(),
          stop: watchTerminal(where(agent), (screen) => {
            term!.screen = screen;
            for (const viewer of term!.viewers) send(viewer, { type: 'term', agentId: agent.id, ...screen });
          }),
        };
        terminals.set(agent.id, term);
      }
      term.viewers.add(ws);
      if (term.screen) send(ws, { type: 'term', agentId: agent.id, ...term.screen });
      return;
    }
    case 'term_close':
      return unwatch(msg.agentId, ws);
    case 'term_input':
      if (agent?.harness !== 'terminal') return;
      return sendToTerminal(
        where(agent),
        typeof msg.text === 'string' ? msg.text.slice(0, 10_000) : undefined,
        isTermKey(msg.key) ? msg.key : undefined,
      );
    case 'prompt':
      if (agent?.harness !== 'claude' || typeof msg.text !== 'string' || !msg.text.trim()) return;
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

/**
 * One client connection, over any transport that carries text frames. Runs the handshake, then
 * turns sealed frames into client messages and server messages into sealed frames.
 */
function accept(wire: { send: (frame: string) => void; close: () => void }) {
  let secure: ReturnType<typeof session> | undefined;
  let client: Client | undefined;
  const closed = () => {
    if (!client) return;
    clients.delete(client);
    for (const agentId of [...terminals.keys()]) unwatch(agentId, client);
    client = undefined;
  };
  const receive = (raw: string) => {
    try {
      const frame: Frame = JSON.parse(raw);
      if (frame.t === 'hello' && !secure) {
        const nonce = randomBytes(NONCE_BYTES).toString('hex');
        secure = session(psk, 'device', frame.n, nonce);
        return wire.send(JSON.stringify({ t: 'hello', n: nonce } satisfies Frame));
      }
      if (frame.t !== 'data' || !secure) throw new Error('unexpected frame');
      const msg: ClientMessage = JSON.parse(secure.open(frame.b));
      if (!msg || typeof msg !== 'object') throw new Error('not a message');
      if (!client) {
        // Opening a frame is the proof that this client holds the key. Until now it was sent nothing.
        const { seal } = secure;
        client = { send: (m) => wire.send(JSON.stringify({ t: 'data', b: seal(JSON.stringify(m)) } satisfies Frame)) };
        clients.add(client);
      }
      const to = client;
      handle(msg, to).catch((err) => send(to, { type: 'failed', message: err.message }));
    } catch {
      // Anything malformed or that fails to open ends the connection; a session cannot recover from it.
      closed();
      wire.close();
    }
  };
  return { receive, closed };
}

// --- Local network: clients connect straight to us.
const wss = new WebSocketServer({ port, maxPayload: 1 << 20 });
wss.on('connection', (ws) => {
  const conn = accept({
    send: (frame) => void (ws.readyState === ws.OPEN && ws.send(frame)),
    close: () => ws.close(),
  });
  ws.on('message', (raw) => conn.receive(String(raw)));
  ws.on('close', conn.closed);
});

// --- Relay: we hold one outbound connection, and the relay multiplexes clients over it. Each of
// our frames is wrapped as { c: client id, m: frame }; { c, t: 'close' } ends that client either way.
function dialRelay() {
  const ws = new WebSocket(`${relayUrl}/v1/${deviceId}?role=device&k=${relayKey}`);
  const conns = new Map<string, ReturnType<typeof accept>>();
  const tell = (msg: object) => void (ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)));
  // A half-dead connection looks open forever, so check it answers.
  let answered = true;
  const heartbeat = setInterval(() => {
    if (!answered) return ws.close();
    answered = false;
    if (ws.readyState === ws.OPEN) ws.send('ping');
  }, 30_000);
  ws.onopen = () => console.log('relay: connected');
  ws.onmessage = ({ data }) => {
    if (data === 'pong') return void (answered = true);
    let msg: { c?: unknown; t?: unknown; m?: unknown };
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const c = msg.c;
    if (typeof c !== 'string') return;
    if (msg.t === 'close') {
      conns.get(c)?.closed();
      return void conns.delete(c);
    }
    if (typeof msg.m !== 'string') return;
    let conn = conns.get(c);
    if (!conn) {
      conn = accept({
        send: (frame) => tell({ c, m: frame }),
        close: () => {
          conns.delete(c);
          tell({ c, t: 'close' });
        },
      });
      conns.set(c, conn);
    }
    conn.receive(msg.m);
  };
  ws.onerror = () => {}; // 'close' follows and does the work
  ws.onclose = () => {
    clearInterval(heartbeat);
    for (const conn of conns.values()) conn.closed();
    // ponytail: fixed retry. Add backoff with jitter if many devices ever reconnect at once.
    setTimeout(dialRelay, 5_000);
  };
}
if (relayUrl) dialRelay();

wss.on('listening', () => {
  console.log(`toto-server on :${port}, data in ${dataDir}${relayUrl ? `, relay ${relayUrl}` : ''}`);
  if (!process.env.TOTO_TOKEN) console.log(`token: ${token}`);
});
