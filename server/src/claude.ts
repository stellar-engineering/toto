import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, ImageRef } from '../../protocol.ts';
import { flagOn } from './flags.ts';
import { command, dataDir } from './projects.ts';

// The browser for agents: a plugin shipped with the server (so every project has it, and an update
// keeps it current), driving the Chromium that install.sh puts on the device.
const BROWSER_PLUGIN = fileURLToPath(new URL('../plugins/browser', import.meta.url));
const CHROMIUM = '/usr/bin/chromium';

/** What gives a Claude session its browser; nothing on a machine that has no Chromium to drive. */
export const browserArgs = (plugin = BROWSER_PLUGIN, chromium = CHROMIUM): string[] =>
  existsSync(plugin) && existsSync(chromium) ? ['--plugin-dir', plugin] : [];

// Plugins installed on this device (see bin/toto-plugin.mjs). The installer put them there after
// checking their signature; they are root's, so nothing here can have been written by an agent.
const PLUGINS = '/var/lib/toto-plugins';

/** What gives a Claude session each plugin that is installed. */
export const pluginArgs = (dir = PLUGINS): string[] => {
  try {
    return readdirSync(dir).sort().filter((name) => existsSync(`${dir}/${name}/.claude-plugin/plugin.json`)).flatMap((name) => ['--plugin-dir', `${dir}/${name}`]);
  } catch {
    return [];
  }
};

// What lets an agent send the person a file (see plugins/files), shipped with the server like the browser's.
const FILES_PLUGIN = fileURLToPath(new URL('../plugins/files', import.meta.url));
export const filesArgs = (plugin = FILES_PLUGIN): string[] => (existsSync(plugin) ? ['--plugin-dir', plugin] : []);

/** Puts a picture away and gives back the reference to it; undefined if it is not one worth keeping. */
type Keep = (mime: unknown, base64: unknown) => ImageRef | undefined;

const isPicture = (b: any) => b?.type === 'image' && b.source?.type === 'base64';

/** The text of a tool's result. Pictures that were kept are left out of it; they are shown as pictures. */
const blockText = (content: unknown, kept: boolean): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b) => !(kept && isPicture(b))).map((b) => (b?.type === 'text' ? b.text : `[${b?.type}]`)).join('\n')
      : '';

/**
 * For finding out what Claude really sends about subagents: with the debugStream flag on, the messages
 * that are about them (system messages, anything from inside one, the calls that start them) are kept,
 * cut short and without picture data, in a private file in the data directory.
 */
function debugStream(msg: any, line: string) {
  if (!flagOn('debugStream')) return;
  if (!(msg?.type === 'system' || msg?.parent_tool_use_id || /"name":"(Agent|Task)"|agentId/.test(line))) return;
  const short = line.replace(/"data":"[^"]{100,}"/g, '"data":"…"').slice(0, 3000);
  appendFileSync(join(dataDir, 'debug-stream.jsonl'), short + '\n', { mode: 0o600 });
}

/**
 * The text Claude has just written, from a partial-message update, or nothing for any other message.
 * Only the agent's own words: what a sub-agent writes (it has a parent tool call) is not shown as it goes.
 */
export const deltaOf = (msg: any): string | undefined =>
  msg?.type === 'stream_event' && !msg.parent_tool_use_id && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta' && typeof msg.event.delta.text === 'string'
    ? msg.event.delta.text
    : undefined;

/**
 * Maps one parsed message from `claude --output-format stream-json` onto common events. With
 * `keep`, pictures in a tool's result (a screenshot, an image file it read) are kept and referred to.
 */
export function toEvents(msg: any, keep?: Keep): AgentEvent[] {
  if (msg?.type === 'result') return [{ type: 'done', isError: !!msg.is_error }];
  if (msg?.type !== 'assistant' && msg?.type !== 'user') return [];
  const content = msg.message?.content;
  if (!Array.isArray(content)) return [];
  // Messages from inside a subagent say which call started it.
  const parent: { parent?: string } = typeof msg.parent_tool_use_id === 'string' && msg.parent_tool_use_id ? { parent: msg.parent_tool_use_id } : {};
  return content.flatMap((b: any): AgentEvent[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text, ...parent }];
    if (b.type === 'tool_use') return [{ type: 'tool_call', id: b.id, name: b.name, input: b.input, ...parent }];
    if (b.type === 'tool_result') {
      const images = keep && Array.isArray(b.content) ? b.content.filter(isPicture).flatMap((p: any) => keep(p.source.media_type, p.source.data) ?? []) : [];
      return [{ type: 'tool_result', id: b.tool_use_id, output: blockText(b.content, !!keep), isError: !!b.is_error, ...(images.length ? { images } : null), ...parent }];
    }
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
  /** Where pictures the agent produces are put. */
  keepImage?: Keep;
  /** Words as Claude writes them, before the whole message arrives. */
  onDelta?: (text: string) => void;
  /** The conversation's id, or undefined when the one asked for could not be resumed. */
  onSession: (id: string | undefined) => void;
  /** Fires once when the process is gone. */
  onExit: () => void;
};

/** Starts a long-lived Claude Code process. */
export function startClaude({ cwd, user, sessionId, onEvent, keepImage, onDelta, onSession, onExit }: Options) {
  const [file, args, opts] = command(user, cwd, process.env.TOTO_CLAUDE_BIN ?? 'claude', [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    // Words as they are written, so a long answer can be read while it is still coming.
    '--include-partial-messages',
    // Claude asks us before anything risky; the server decides whether that reaches the user.
    '--permission-mode', 'manual',
    '--permission-prompt-tool', 'stdio',
    ...browserArgs(),
    ...filesArgs(),
    ...pluginArgs(),
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
    debugStream(msg, line);
    const delta = deltaOf(msg);
    if (delta) return onDelta?.(delta);
    toEvents(msg, keepImage).forEach(onEvent);
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
    /** What the person said, with any pictures they sent along. */
    send: (text: string, pictures: { mime: string; data: string }[] = []) =>
      write({
        type: 'user',
        message: {
          role: 'user',
          content: pictures.length
            ? [...pictures.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } })), ...(text ? [{ type: 'text', text }] : [])]
            : text,
        },
      }),
    // Interrupts any turn in flight and closes stdin, which makes claude exit. Under sudo the
    // child is not ours to signal.
    stop: () => {
      stopping = true;
      write({ type: 'control_request', request_id: 'stop', request: { subtype: 'interrupt' } });
      child.stdin.end();
    },
    /** Answers an open approval. Ignores ids that are unknown or already answered. */
    resolve: (id: string, allow: boolean, answers?: Record<string, string>) => {
      const p = pending.get(id);
      if (!p) return;
      const input = answers && p.input && typeof p.input === 'object' ? { ...p.input, answers } : p.input;
      respond(p.requestId, {
        subtype: 'success',
        response: allow
          ? { behavior: 'allow', updatedInput: input }
          : { behavior: 'deny', message: 'The user denied this action.' },
      });
      settle(id, allow);
    },
  };
}
