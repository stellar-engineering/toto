// A pretend Toto that lives inside the app, for looking around without owning one: the people
// who review the app for a store, and anyone curious. It speaks the same messages a real one
// does, so every screen is the real screen; only what is on the other end is made up.
// Nothing here leaves the phone, and nothing is kept: it starts over each time it is opened.
import type { Agent, AgentEvent, ClientMessage, Project, ServerMessage } from '../../protocol';

/** The address that means "the demo", where a real Toto has ws://… */
export const DEMO = 'demo:';
export const DEMO_NODE = { id: 'demo', name: 'Demo Toto', address: DEMO, token: 'demo', relay: '' };

const REPLY = `Done. The sender now retries with exponential backoff and jitter:

\`\`\`ts
const delay = Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
\`\`\`

Three new tests cover a delivery that succeeds on the second try, one that gives up after five, and the cap on the delay. All 41 tests pass.`;

const TERMINAL = ['\u001b[32mdemo@toto\u001b[0m:\u001b[34m~/webhooks\u001b[0m$ git status', 'On branch main', 'nothing to commit, working tree clean', '\u001b[32mdemo@toto\u001b[0m:\u001b[34m~/webhooks\u001b[0m$ '].join('\n');

/** Opens a line to the demo. `say` is how it talks back; returns how the app talks to it. */
export function demo(say: (message: ServerMessage) => void): (message: ClientMessage) => void {
  let name = DEMO_NODE.name;
  let projects: Project[] = [{ id: 'd0000001', name: 'webhooks', repo: 'git@github.com:example/webhooks.git', lan: false }];
  let agents: Agent[] = [
    { id: 'a0000001', projectId: 'd0000001', name: 'backoff', harness: 'claude', mode: 'ask', worktree: true },
    { id: 'a0000002', projectId: 'd0000001', name: 'docs', harness: 'claude', mode: 'ask', worktree: true },
    { id: 'a0000003', projectId: 'd0000001', name: 'shell', harness: 'terminal', mode: 'ask', worktree: false },
  ];
  const logs: Record<string, AgentEvent[]> = {
    a0000001: [
      { type: 'user', text: 'Add exponential backoff to the webhook sender and cover it with tests.' },
      { type: 'tool_call', id: 't1', name: 'Read', input: { file_path: 'src/webhooks/sender.ts' } },
      { type: 'tool_result', id: 't1', output: 'export async function send(hook: Hook, payload: unknown) {', isError: false },
      { type: 'tool_call', id: 't2', name: 'Edit', input: { file_path: 'src/webhooks/sender.ts' } },
      { type: 'tool_result', id: 't2', output: 'Added a retry loop with jittered backoff.', isError: false },
      // Two subagents at once: a reviewer that has finished, and a test writer that is still going.
      { type: 'tool_call', id: 's1', name: 'Agent', input: { subagent_type: 'code-reviewer', description: 'Review the retry loop', prompt: 'Read src/webhooks/sender.ts and say whether the retry loop can retry for ever, or retry something that should not be retried.' } },
      { type: 'tool_call', id: 's2', name: 'Agent', input: { subagent_type: 'test-writer', description: 'Write tests for the backoff', prompt: 'Add tests to src/webhooks/sender.test.ts for a delivery that succeeds on the second try, one that gives up, and the cap on the delay.' } },
      { type: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'src/webhooks/sender.ts' }, parent: 's1' },
      { type: 'tool_result', id: 'c1', output: 'export async function send(hook: Hook, payload: unknown) {', isError: false, parent: 's1' },
      { type: 'tool_call', id: 'c2', name: 'Grep', input: { pattern: 'attempt' }, parent: 's1' },
      { type: 'tool_result', id: 'c2', output: 'src/webhooks/sender.ts: 6 matches', isError: false, parent: 's1' },
      { type: 'tool_result', id: 's1', output: 'The loop stops after five attempts and only retries on network errors and 5xx responses. One thing to fix: a 429 with a Retry-After header should wait that long, not the computed delay.', isError: false },
      { type: 'tool_call', id: 'c3', name: 'Edit', input: { file_path: 'src/webhooks/sender.test.ts' }, parent: 's2' },
      { type: 'tool_call', id: 't3', name: 'Bash', input: { command: 'npm test -- webhooks' } },
      { type: 'approval_request', id: 't3', name: 'Bash', input: { command: 'npm test -- webhooks' } },
    ],
    a0000002: [
      { type: 'user', text: 'Write up how the retry queue works for the README.' },
      { type: 'text', text: 'I have added a **Retries** section to the README. It explains the queue, the backoff schedule and how to change the limit, with a short example.' },
      { type: 'done', isError: false },
    ],
    a0000003: [],
  };
  // Agents partway through a turn, and what has been left waiting for each.
  // (The first agent starts with a question already open.)
  const working = new Set<string>(['a0000001']);
  let writerDone = false;
  let flagOn = false;
  const waiting: Record<string, { text: string }[]> = {};
  let next = 0;
  const id = () => `d${String(++next).padStart(7, '0')}`;
  const later = (ms: number, what: () => void) => setTimeout(what, ms);
  const state = (): ServerMessage => ({
    type: 'state', name, claude: 'subscription', projects, agents, identity: { name: 'Demo', email: 'demo@example.com' },
    version: 'demo', updating: false, phones: [], owner: true,
    flags: [{ name: 'debugStream', label: 'Keep subagent messages', about: 'Saves the messages Claude sends about subagents to a private file on this Toto, to see what is really in them. Shortened, with no pictures.', on: flagOn }],
    plugins: [{ name: 'gh', description: 'GitHub’s command line, for agents: pull requests, issues and checks.', login: true }],
  });
  const emit = (agentId: string, event: AgentEvent) => {
    (logs[agentId] ??= []).push(event);
    say({ type: 'event', agentId, event });
  };
  const notHere = () => say({ type: 'failed', message: 'This is the demo, so that does nothing here. It works on a Toto of your own.' });

  return (msg) => {
    switch (msg.type) {
      case 'sync':
        say(state());
        for (const [agentId, log] of Object.entries(logs)) for (const event of log) say({ type: 'event', agentId, event });
        return say({ type: 'synced' });
      case 'ping':
        return say({ type: 'pong', name });
      case 'rename_device':
        name = msg.name.trim() || name;
        return say(state());
      case 'create_project':
        // A real one clones the repository, which takes a moment.
        return void later(1800, () => {
          projects = [...projects, { id: id(), name: msg.name.trim(), repo: msg.repo.trim(), lan: false }];
          say(state());
        });
      case 'delete_project':
        projects = projects.filter((p) => p.id !== msg.projectId);
        agents = agents.filter((a) => a.projectId !== msg.projectId);
        return say(state());
      case 'set_lan':
        projects = projects.map((p) => (p.id === msg.projectId ? { ...p, lan: msg.allow } : p));
        return say(state());
      case 'create_agent':
        return void later(900, () => {
          const agent: Agent = { id: id(), projectId: msg.projectId, name: msg.name.trim(), harness: msg.harness, mode: msg.mode, worktree: msg.worktree };
          agents = [...agents, agent];
          logs[agent.id] = [];
          say(state());
        });
      case 'delete_agent':
        agents = agents.filter((a) => a.id !== msg.agentId);
        delete logs[msg.agentId];
        return say(state());
      case 'set_mode':
        agents = agents.map((a) => (a.id === msg.agentId ? { ...a, mode: msg.mode } : a));
        return say(state());
      case 'prompt':
        // Mid-turn, a message that is to wait does; anything else goes in at once.
        if (msg.later && working.has(msg.agentId)) {
          (waiting[msg.agentId] ??= []).push({ text: msg.text });
          return say({ type: 'queue', agentId: msg.agentId, items: waiting[msg.agentId] });
        }
        return ask(msg.agentId, msg.text);
      case 'set_flag':
        flagOn = msg.on;
        return say(state());
      case 'unqueue':
        waiting[msg.agentId]?.splice(msg.index, 1);
        return say({ type: 'queue', agentId: msg.agentId, items: waiting[msg.agentId] ?? [] });
      case 'approve':
        return decide(msg.agentId, msg.id, msg.allow);
      case 'term_open':
        return say({ type: 'term', agentId: msg.agentId, screen: TERMINAL, cursor: { row: 3, col: 22 } });
      case 'term_close':
      case 'term_input':
      case 'register_push':
      case 'upload':
        return;
      case 'check_update':
        return say(state());
      default:
        return notHere();
    }
  };

  // Whatever is asked, it does the same small job: reads, stops to ask, and finishes when allowed.
  function ask(agentId: string, text: string) {
    working.add(agentId);
    emit(agentId, { type: 'user', text });
    const call = id();
    later(1200, () => emit(agentId, { type: 'tool_call', id: call, name: 'Bash', input: { command: 'npm test' } }));
    later(1600, () => {
      const auto = agents.find((a) => a.id === agentId)?.mode === 'auto';
      emit(agentId, { type: 'approval_request', id: call, name: 'Bash', input: { command: 'npm test' } });
      if (auto) decide(agentId, call, true);
    });
  }

  /** The turn is over: whatever was waiting is said next. */
  function finish(agentId: string) {
    working.delete(agentId);
    // The test writer was still going when the demo began; it is done by the time the turn is.
    if (agentId === 'a0000001' && !writerDone) {
      writerDone = true;
      emit(agentId, { type: 'tool_result', id: 'c3', output: 'Added 3 tests.', isError: false, parent: 's2' });
      emit(agentId, { type: 'tool_result', id: 's2', output: 'Added three tests to sender.test.ts: success on the second try, giving up after five, and the cap on the delay.', isError: false });
    }
    emit(agentId, { type: 'done', isError: false });
    const next = waiting[agentId]?.shift();
    if (!next) return;
    say({ type: 'queue', agentId, items: waiting[agentId] });
    ask(agentId, next.text);
  }

  function decide(agentId: string, call: string, allow: boolean) {
    emit(agentId, { type: 'approval_resolved', id: call, allowed: allow });
    if (!allow) return void later(600, () => finish(agentId));
    later(1400, () => emit(agentId, { type: 'tool_result', id: call, output: 'Tests: 41 passed, 41 total', isError: false }));
    later(2400, () => emit(agentId, { type: 'text', text: REPLY }));
    later(2500, () => finish(agentId));
  }
}

/** A line to the demo that can be hung up: nothing it had queued up is said after `close`. */
export function openDemo(say: (message: ServerMessage) => void) {
  let open = true;
  const hear = demo((message) => open && say(message));
  return { send: hear, close: () => void (open = false) };
}
