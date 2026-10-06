import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent } from '../../protocol.ts';

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

/** Starts a long-lived Claude Code process in `cwd`. `onExit` fires once when it is gone. */
export function startClaude(cwd: string, onEvent: (e: AgentEvent) => void, onExit: () => void) {
  const child = spawn(
    process.env.TOTO_CLAUDE_BIN ?? 'claude',
    [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      // Claude asks us before anything risky; the server decides whether that reaches the user.
      '--permission-mode', 'manual',
      '--permission-prompt-tool', 'stdio',
    ],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const write = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
  const respond = (requestId: string, body: object) =>
    write({ type: 'control_response', response: { request_id: requestId, ...body } });

  // Tool call id -> the permission request Claude is blocked on for it.
  const pending = new Map<string, { requestId: string; input: unknown }>();
  const settle = (id: string, allowed: boolean) => {
    pending.delete(id);
    onEvent({ type: 'approval_resolved', id, allowed });
  };

  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
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
  const exit = (message: string) => {
    if (exited) return;
    exited = true;
    for (const id of [...pending.keys()]) settle(id, false);
    onEvent({ type: 'error', message });
    onExit();
  };
  child.on('error', (err) => exit(`could not start claude: ${err.message}`));
  child.on('close', (code) => exit(`claude exited (${code})${stderr ? `: ${stderr.trim()}` : ''}`));
  child.stdin.on('error', () => {}); // a write racing the exit; 'close' reports it

  return {
    send: (text: string) => write({ type: 'user', message: { role: 'user', content: text } }),
    stop: () => child.kill(),
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
