// Wire protocol between toto-server and its clients, as JSON over WebSocket.
// Types only: always `import type` so neither Node nor Metro resolves this file at runtime.

/** Server -> client. The common event stream every harness adapter maps onto. */
export type AgentEvent =
  | { type: 'user'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'done'; isError: boolean }
  | { type: 'error'; message: string };

/** Client -> server. */
export type ClientMessage = { type: 'prompt'; text: string };
