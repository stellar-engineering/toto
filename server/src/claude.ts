import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent } from '../../protocol.ts';

const blockText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b?.type === 'text' ? b.text : `[${b?.type}]`)).join('\n')
      : '';

/** Maps one line of `claude --output-format stream-json` onto common events. */
export function toEvents(line: string): AgentEvent[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
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
    'claude',
    [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      // ponytail: fixed mode, so shell commands are denied. Real approvals arrive with M1.
      '--permission-mode', process.env.TOTO_PERMISSION_MODE ?? 'acceptEdits',
    ],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
  createInterface({ input: child.stdout }).on('line', (line) => toEvents(line).forEach(onEvent));

  let exited = false;
  const exit = (message: string) => {
    if (exited) return;
    exited = true;
    onEvent({ type: 'error', message });
    onExit();
  };
  child.on('error', (err) => exit(`could not start claude: ${err.message}`));
  child.on('close', (code) => exit(`claude exited (${code})${stderr ? `: ${stderr.trim()}` : ''}`));
  child.stdin.on('error', () => {}); // a write racing the exit; 'close' reports it

  return {
    send: (text: string) =>
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'),
  };
}
