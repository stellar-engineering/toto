// Wire protocol between toto-server and its clients, as JSON over WebSocket.
// Types only: always `import type` so neither Node nor Metro resolves this file at runtime.

/** Server -> client. The common event stream every harness adapter maps onto. */
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

/** Server -> client. `mode` is current state, sent on connect and on change; it is not history. */
export type ServerMessage = AgentEvent | { type: 'mode'; mode: Mode };

/** Client -> server. */
export type ClientMessage =
  | { type: 'prompt'; text: string }
  | { type: 'approve'; id: string; allow: boolean }
  | { type: 'set_mode'; mode: Mode };
