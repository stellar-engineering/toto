#!/usr/bin/env node
// An MCP server with one tool, `send_file`, for an agent to hand the person a file from its project.
// It only checks the file and says so: the Toto's server sees the call and does the sending, reading
// the file as the same user. So this is not trusted with anything; it is there to give the agent
// the tool and to turn away what could not be sent before the agent believes it was.
import { realpathSync, statSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const MAX_FILE = 10 * 1024 * 1024;

const TOOL = {
  name: 'send_file',
  description: 'Send a file from this project to the person on their phone, where they can save it. Use it for things they asked for or will want to keep: a report, a build, an export, a log. Up to 10 MB. A picture you want them to see is better shown with a screenshot.',
  inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'The file, relative to the project or absolute. It must be inside the project.' } }, required: ['path'] },
};

/** Says what is wrong with sending `path`, or nothing if it can be. */
export function problem(path, cwd = process.cwd()) {
  if (typeof path !== 'string' || !path) return 'Say which file to send.';
  let real;
  try {
    real = realpathSync(path.startsWith('/') ? path : `${cwd}/${path}`);
  } catch {
    return `There is no file at ${path}.`;
  }
  const root = realpathSync(cwd);
  if (real !== root && !real.startsWith(root + sep)) return 'That file is outside this project, so it cannot be sent.';
  const stat = statSync(real);
  if (!stat.isFile()) return `${basename(real)} is not a file.`;
  if (stat.size === 0) return `${basename(real)} is empty.`;
  if (stat.size > MAX_FILE) return `${basename(real)} is ${(stat.size / 1024 / 1024).toFixed(1)} MB. Files over 10 MB cannot be sent. Make it smaller, or split it.`;
}

/** The answer to one JSON-RPC message, or nothing for a notification. */
export function answer(msg, cwd = process.cwd()) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.id === undefined) return undefined;
  switch (msg.method) {
    case 'initialize':
      return reply({ protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'toto-files', version: '1.0.0' } });
    case 'tools/list':
      return reply({ tools: [TOOL] });
    case 'tools/call': {
      const wrong = msg.params?.name === TOOL.name ? problem(msg.params.arguments?.path, cwd) : 'There is no such tool.';
      return reply({ isError: !!wrong, content: [{ type: 'text', text: wrong ?? `Sent ${basename(msg.params.arguments.path)} to the person's phone.` }] });
    }
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported.' } };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  createInterface({ input: process.stdin }).on('line', (line) => {
    try {
      const out = answer(JSON.parse(line));
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    } catch {
      // Not JSON-RPC; nothing to answer.
    }
  });
