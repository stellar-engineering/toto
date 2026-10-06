import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent } from '../../protocol.ts';
import { command } from './projects.ts';

const blockText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b?.type === 'text' ? b.text : `[${b?.type}]`)).join('\n')
      : '';

/** Maps one parsed message from `claude --output-format stream-json` onto common events. */
export function toEvents(msg: any): AgentEvent[] {
  if (msg?.type === 'result') return [{ type: 'done', isError: !!msg.is_error }];
  if (msg?.type !== 'assistant' && msg?.type !== 'user') return [];
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((b: any): AgentEvent[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text }];
    if (b.type === 'tool_use') return [{ type: 'tool_call', id: b.id, name: b.name, input: b.input }];
    if (b.type === 'tool_result')
      return [{ type: 'tool_result', id: b.tool_use_id, output: blockText(b.content), isError: !!b.is_error }];
    return [];
  });
}

type Options = {
  cwd: string;
  /** Linux user to run as; undefined runs as the server's own user. */
  user?: string;
  /** Conversation to pick up again. */
  sessionId?: string;
  onEvent: (e: AgentEvent) => void;
  /** The conversation's id, or undefined when the one asked for could not be resumed. */
  onSession: (id: string | undefined) => void;
  /** Fires once when the process is gone. */
  onExit: () => void;
};

/** Starts a long-lived Claude Code process. */
export function startClaude({ cwd, user, sessionId, onEvent, onSession, onExit }: Options) {
  const [file, args, opts] = command(user, cwd, process.env.TOTO_CLAUDE_BIN ?? 'claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    // Claude asks us before anything risky; the server decides whether that reaches the user.
    '--permission-mode', 'manual',
    '--permission-prompt-tool', 'stdio',
    ...(sessionId ? ['--resume', sessionId] : []),
  ]);
  const child = spawn(file, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
  const respond = (requestId: string, body: object) =>
    write({ type: 'control_response', response: { request_id: requestId, ...body } });

  // Tool call id -> the permission request Claude is blocked on for it.
  const pending = new Map<string, { requestId: string; input: unknown }>();
  const settle = (id: string, allowed: boolean) => {
    pending.delete(id);
    onEvent({ type: 'approval_resolved', id, allowed });
  };

  let session: string | undefined;
  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg?.session_id === 'string' && msg.session_id !== session) onSession((session = msg.session_id));
    if (msg?.type === 'control_request') {
      const req = msg.request;
      if (req?.subtype !== 'can_use_tool')
        return respond(msg.request_id, { subtype: 'error', error: `unsupported request: ${req?.subtype}` });
      pending.set(req.tool_use_id, { requestId: msg.request_id, input: req.input });
      return onEvent({ type: 'approval_request', id: req.tool_use_id, name: req.tool_name, input: req.input });
    }
    if (msg?.type === 'control_cancel_request') {
      for (const [id, p] of pending) if (p.requestId === msg.request_id) settle(id, false);
      return;
    }
    toEvents(msg).forEach(onEvent);
  });

  let exited = false;
  let stopping = false;
  const exit = (message?: string) => {
    if (exited) return;
    exited = true;
    for (const id of [...pending.keys()]) settle(id, false);
    // It died without resuming, so stop asking for that conversation or every restart fails the same way.
    if (sessionId && !session && !stopping) onSession(undefined);
    if (message && !stopping) onEvent({ type: 'error', message });
    onExit();
  };
  child.on('error', (err) => exit(`could not start claude: ${err.message}`));
  child.on('close', (code) => exit(code === 0 ? undefined : `claude exited (${code})${stderr ? `: ${stderr.trim()}` : ''}`));
  child.stdin.on('error', () => {}); // a write racing the exit; 'close' reports it

  return {
    send: (text: string) => write({ type: 'user', message: { role: 'user', content: text } }),
    // Interrupts any turn in flight and closes stdin, which makes claude exit. Under sudo the
    // child is not ours to signal.
    stop: () => {
      stopping = true;
      write({ type: 'control_request', request_id: 'stop', request: { subtype: 'interrupt' } });
      child.stdin.end();
    },
    /** Answers an open approval. Ignores ids that are unknown or already answered. */
    resolve: (id: string, allow: boolean) => {
      const p = pending.get(id);
      if (!p) return;
      respond(p.requestId, {
        subtype: 'success',
        response: allow
          ? { behavior: 'allow', updatedInput: p.input }
          : { behavior: 'deny', message: 'The user denied this action.' },
      });
      settle(id, allow);
    },
  };
}
