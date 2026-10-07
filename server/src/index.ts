import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Agent, AgentEvent, ClaudeAccount, ClientMessage, Identity, Mode, Project, ServerMessage } from '../../protocol.ts';
import { cancelLogin, credentialsWork, finishLogin, startLogin } from './login.ts';
import { type Screen, killTerminal, openTerminal, watchTerminal } from './terminal.ts';
import { startBluetooth } from './ble.ts';
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
  startUpdate,
  removeProject,
  removeWorktree,
  setLan,
  wifiCountry,
  wifiJoin,
  wifiList,
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
const state: { name: string; claimed: boolean; projects: ProjectRecord[]; agents: AgentRecord[]; identity: Identity; pushTokens: string[] } = {
  // Whether anyone has connected yet. Until someone has, a phone nearby may set this device up
  // over Bluetooth and be handed its keys; afterwards only a phone that already holds them may.
  // A device with saved state from before this was recorded has been in use, so it has one.
  claimed: existsSync(stateFile),
  // What this device is called, until someone gives it a better name from the app.
  name: hostname(),
  projects: [],
  agents: [],
  pushTokens: [],
  // A placeholder so commits never fail for want of an author; the app asks for the real one.
  identity: { name: 'Toto', email: `toto@${hostname()}` },
  ...(existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}),
};
const logFile = (agentId: string) => join(logDir, `${agentId}.jsonl`);

// --- How agents are signed in to Claude. Set from the app and kept in a private file; whatever
// was put in the service's environment by hand is the fallback. Either way it reaches agents
// through this process's environment (see installEnv).
type Credential = { kind: 'oauth_token' | 'api_key'; value: string };
const credentialFile = join(dataDir, 'credentials.json');
const useCredential = (c: Credential | undefined) => {
  if (!c) return;
  process.env[c.kind === 'api_key' ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN'] = c.value;
  delete process.env[c.kind === 'api_key' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'];
};
if (existsSync(credentialFile)) useCredential(JSON.parse(readFileSync(credentialFile, 'utf8')));
const claude = (): ClaudeAccount => (process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription' : process.env.ANTHROPIC_API_KEY ? 'api_key' : 'none');
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
const terminals = new Map<string, { viewers: Set<Client>; screen?: Screen } & ReturnType<typeof watchTerminal>>();
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
// --- Updates. The server only notices that a release exists and asks for it; fetching, checking
// its signature and installing are the root updater's job (bin/toto-update.mjs), which does not
// take our word for anything.
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const RELEASES = 'https://github.com/stellar-engineering/toto/releases/latest/download';
let latest: string | undefined;
let updating = false;
async function checkForUpdate() {
  const res = await fetch(`${RELEASES}/version`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  const found = res?.ok ? (await res.text()).trim() : undefined;
  // Only a hint for the app to show: the updater decides for itself what is newer.
  if (!found || !/^\d+\.\d+\.\d+$/.test(found) || found === latest) return;
  latest = found;
  broadcast(snapshot());
}

const snapshot = (): ServerMessage => ({
  type: 'state',
  name: state.name,
  claude: claude(),
  projects: state.projects,
  agents: state.agents,
  identity: state.identity,
  sshKey,
  version,
  latest: latest === version ? undefined : latest,
  updating,
});

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
  void push(state.pushTokens, kind, agent.id, { name: state.name, id: deviceId }).then((dead) => {
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

/** Changes how agents are signed in to Claude, or signs them out, and lets everything know. */
async function signIn(credential: Credential | undefined) {
  if (credential) {
    writeFileSync(credentialFile, JSON.stringify(credential), { mode: 0o600 });
    useCredential(credential);
  } else {
    rmSync(credentialFile, { force: true });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  await Promise.all(state.projects.map((p) => installEnv(p.user).catch(() => {})));
  // Agents already running hold the old sign-in; stopping them means their next turn starts with the new one.
  for (const proc of running.values()) proc.stop();
  commit();
}

async function handle(msg: ClientMessage, ws: Client) {
  const agent = 'agentId' in msg ? state.agents.find((a) => a.id === msg.agentId) : undefined;
  switch (msg?.type) {
    case 'sync':
      if (!state.claimed) {
        state.claimed = true;
        save();
      }
      send(ws, snapshot());
      for (const [agentId, log] of logs) for (const event of log) send(ws, { type: 'event', agentId, event });
      return send(ws, { type: 'synced' });
    case 'ping':
      return send(ws, { type: 'pong', name: state.name });
    case 'rename_device':
      if (!isName(msg.name)) throw new Error('A name needs to be between 1 and 60 characters.');
      state.name = msg.name.trim();
      return commit();
    case 'claude_login':
      return send(ws, { type: 'claude_login', url: await startLogin() });
    case 'claude_code': {
      if (typeof msg.code !== 'string' || !msg.code.trim() || msg.code.length > 2000) throw new Error('Paste the code the sign-in page showed you.');
      return signIn({ kind: 'oauth_token', value: await finishLogin(msg.code) });
    }
    case 'claude_key': {
      if (typeof msg.key !== 'string' || !/^sk-ant-[\w-]{20,}$/.test(msg.key.trim())) throw new Error('That does not look like an Anthropic API key. They start with sk-ant-.');
      // Try it before keeping it, so a mistyped key is caught here and not by the first agent.
      const before = { key: process.env.ANTHROPIC_API_KEY, token: process.env.CLAUDE_CODE_OAUTH_TOKEN };
      useCredential({ kind: 'api_key', value: msg.key.trim() });
      if (await credentialsWork()) return signIn({ kind: 'api_key', value: msg.key.trim() });
      delete process.env.ANTHROPIC_API_KEY;
      if (before.key) process.env.ANTHROPIC_API_KEY = before.key;
      if (before.token) process.env.CLAUDE_CODE_OAUTH_TOKEN = before.token;
      throw new Error('Claude did not accept that key.');
    }
    case 'claude_logout':
      await cancelLogin();
      return signIn(undefined);
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
        const viewers = new Set<Client>();
        const watching = watchTerminal(where(agent), (screen) => {
          const open = terminals.get(agent.id);
          if (open) open.screen = screen;
          for (const viewer of viewers) send(viewer, { type: 'term', agentId: agent.id, ...screen });
        });
        term = { viewers, ...watching };
        terminals.set(agent.id, term);
      }
      term.viewers.add(ws);
      if (term.screen) send(ws, { type: 'term', agentId: agent.id, ...term.screen });
      return;
    }
    case 'term_close':
      return unwatch(msg.agentId, ws);
    case 'term_input': {
      // Only into a terminal this client has open, which is also what gives us somewhere to send it.
      const term = agent && terminals.get(agent.id);
      if (!term?.viewers.has(ws)) return;
      return term.type(typeof msg.text === 'string' ? msg.text.slice(0, 10_000) : undefined, msg.key);
    }
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
    case 'check_update':
      await checkForUpdate();
      return send(ws, snapshot());
    case 'update': {
      // The install restarts the server, which would cut off anything mid-thought.
      if (running.size) throw new Error('Agents are working. Update when they have finished.');
      updating = true;
      broadcast(snapshot());
      try {
        await startUpdate();
      } catch (err) {
        updating = false;
        broadcast(snapshot());
        throw err;
      }
      return;
    }
    default:
      // An app newer than this server asking for something added since. Say so: silence leaves it waiting for ever.
      throw new Error('This Toto does not know how to do that yet. It needs updating.');
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
    // The relay passing on that a release was published. Worth a look; nothing is taken on its word.
    if (c === undefined && msg.t === 'update') return void checkForUpdate();
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

// --- Bluetooth: how a phone sets this device up before it can be reached any other way.
//
// A phone can only find this device while it is advertising, and it advertises only when there
// is a reason to: it has no owner yet, someone at the device has opened pairing mode, or it has
// lost its network and its owner needs a way back in.
const lanIp = () => {
  for (const addresses of Object.values(networkInterfaces()))
    for (const a of addresses ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return undefined;
};
const lanAddress = () => `ws://${lanIp() ?? `${hostname()}.local`}:${port}`;

// Pairing mode, opened by hand at the device: for a while, a new phone may claim it as if it had no owner.
let pairingUntil = 0;
const pairing = () => Date.now() < pairingUntil;
const openToClaim = () => !state.claimed || pairing();

// What the device says about itself is read without any waiting, so the network it is on is looked up ahead of time.
let wifiNow: string | null = null;
let offlineSince: number | undefined;
let bluetooth: Awaited<ReturnType<typeof startBluetooth>>;
const visible = () => openToClaim() || (offlineSince !== undefined && Date.now() - offlineSince > 60_000);
const look = async () => {
  await wifiList().then((w) => (wifiNow = w.current)).catch(() => {});
  offlineSince = lanIp() ? undefined : (offlineSince ?? Date.now());
  await bluetooth?.show(visible());
};

startBluetooth({
  psk,
  // "Has an owner" is what makes the phone need the token, so pairing mode reports it as having none.
  info: () => ({ id: deviceId, name: state.name, claimed: !openToClaim(), wifi: wifiNow }),
  handle: async (request) => {
    switch (request?.type) {
      case 'networks': {
        if (typeof request.country === 'string' && /^[A-Z]{2}$/.test(request.country)) await wifiCountry(request.country);
        const found = await wifiList();
        wifiNow = found.current;
        return { type: 'networks', ...found };
      }
      case 'join': {
        if (typeof request.ssid !== 'string' || typeof request.password !== 'string') return { type: 'refused', problem: 'A network needs a name.' };
        try {
          await wifiJoin(request.ssid, request.password);
        } catch (err) {
          return { type: 'joined', ok: false, problem: (err as Error).message };
        } finally {
          await look();
        }
        return { type: 'joined', ok: true };
      }
      case 'claim':
        // Reaching here means the conversation's key was right: for a device with an owner,
        // that took its token. Handing the token over is what makes a phone an owner, and
        // once that has happened there is nothing left to advertise for.
        state.claimed = true;
        pairingUntil = 0;
        save();
        setTimeout(look, 2_000); // after the answer has gone out
        return { type: 'claimed', name: state.name, address: lanAddress(), token, relay: relayUrl ?? '' };
      default:
        return { type: 'refused', problem: 'Not something this device understands.' };
    }
  },
}).then((ready) => {
  bluetooth = ready;
  if (!ready) return;
  look().then(() => console.log(`bluetooth: ${visible() ? 'offering setup' : 'ready, not advertising'}`));
  setInterval(look, 20_000).unref();
});

// --- The device's own console tool (`toto`) talks to us here: one JSON request per line, one
// JSON answer back. The socket's permissions are the access control: this user and root only.
const control = join(process.env.RUNTIME_DIRECTORY ?? dataDir, 'ctl.sock');
rmSync(control, { force: true });
createServer((socket) => {
  socket.on('error', () => {});
  const lines = createInterface({ input: socket });
  lines.on('error', () => {});
  lines.on('line', async (line) => {
    let request: { cmd?: string; minutes?: number; name?: string };
    try {
      request = JSON.parse(line);
    } catch {
      return socket.end();
    }
    if (request.cmd === 'pair') {
      pairingUntil = Date.now() + Math.min(Math.max(Number(request.minutes) || 10, 1), 60) * 60_000;
      await look();
    }
    if (request.cmd === 'stop-pairing') {
      pairingUntil = 0;
      await look();
    }
    if (request.cmd === 'rename' && isName(request.name)) {
      state.name = request.name.trim();
      commit();
    }
    const activities = state.agents.filter((a) => a.harness === 'claude').map((a) => logs.get(a.id) ?? []);
    const waiting = activities.filter((log) => openApprovals(log).length > 0).length;
    socket.write(
      JSON.stringify({
        name: state.name,
        claimed: state.claimed,
        pairingSeconds: Math.max(0, Math.round((pairingUntil - Date.now()) / 1000)),
        advertising: !!bluetooth && visible(),
        bluetooth: !!bluetooth,
        wifi: wifiNow,
        ip: lanIp() ?? null,
        relay: relayUrl ?? null,
        phones: clients.size,
        projects: state.projects.length,
        agents: state.agents.length,
        running: running.size,
        waiting,
      }) + '\n',
    );
  });
})
  // The console tool is a convenience; failing to offer it (a path too long for a socket, say) must not stop the server.
  .on('error', (err) => console.error(`console tool unavailable: ${err.message}`))
  .listen(control, () => chmodSync(control, 0o660));

wss.on('listening', () => {
  console.log(`toto-server on :${port}, data in ${dataDir}${relayUrl ? `, relay ${relayUrl}` : ''}`);
  if (!process.env.TOTO_TOKEN) console.log(`token: ${token}`);
});

// Look for a release now and once a day, so a Toto the relay never reaches still finds out.
void checkForUpdate();
setInterval(checkForUpdate, 24 * 60 * 60_000).unref();
