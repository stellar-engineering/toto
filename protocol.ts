// Wire protocol between toto-server and its clients, as JSON over WebSocket.
// Types only: always `import type` so neither Node nor Metro resolves this file at runtime.

/** The common event stream every harness adapter maps onto. */
export type AgentEvent =
  | { type: 'user'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  // `id` is the id of the tool call waiting on a decision.
  | { type: 'approval_request'; id: string; name: string; input: unknown }
  | { type: 'approval_resolved'; id: string; allowed: boolean }
  | { type: 'done'; isError: boolean }
  | { type: 'error'; message: string };

/** 'ask' pauses the agent for a decision on each risky action; 'auto' approves everything. */
export type Mode = 'ask' | 'auto';

/** A cloned git repo. Every agent in it runs as the same Linux user. */
export type Project = { id: string; name: string; repo: string };

/** `worktree` agents work on their own branch and checkout; the rest share the project's main checkout. */
export type Agent = { id: string; projectId: string; name: string; mode: Mode; worktree: boolean };

/** Server -> client. */
export type ServerMessage =
  // The full picture, sent on connect and again whenever it changes.
  // `sshKey` is the device's public key, for the user to add to their git host.
  | { type: 'state'; projects: Project[]; agents: Agent[]; sshKey?: string }
  | { type: 'event'; agentId: string; event: AgentEvent }
  // A request from this client could not be carried out.
  | { type: 'failed'; message: string };

/** Client -> server. */
export type ClientMessage =
  | { type: 'create_project'; name: string; repo: string }
  | { type: 'create_agent'; projectId: string; name: string; mode: Mode; worktree: boolean }
  | { type: 'prompt'; agentId: string; text: string }
  | { type: 'approve'; agentId: string; id: string; allow: boolean }
  | { type: 'set_mode'; agentId: string; mode: Mode };
