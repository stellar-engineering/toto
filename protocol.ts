// The messages toto-server and its clients exchange. Each travels as JSON inside an encrypted
// frame (see server/src/secure.ts), over a WebSocket to the device or through the relay.
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

/**
 * A cloned git repo. Every agent in it runs as the same Linux user. `lan` says whether those
 * agents may reach devices on the local network; it is absent where projects are not isolated.
 */
export type Project = { id: string; name: string; repo: string; lan?: boolean };

/** 'claude' is a chat with Claude Code. 'terminal' is a shell session for running anything by hand. */
export type Harness = 'claude' | 'terminal';

/** `worktree` agents work on their own branch and checkout; the rest share the project's main checkout. */
export type Agent = { id: string; projectId: string; name: string; harness: Harness; mode: Mode; worktree: boolean };

export type TermKey = 'enter' | 'tab' | 'escape' | 'backspace' | 'up' | 'down' | 'left' | 'right' | 'ctrl-c' | 'ctrl-d';

/** Who agents' git commits are attributed to. */
export type Identity = { name: string; email: string };

/** Server -> client. */
export type ServerMessage =
  // The full picture, sent in answer to `sync` and again whenever it changes.
  // `sshKey` is the device's public key, for the user to add to their git host.
  | { type: 'state'; projects: Project[]; agents: Agent[]; identity: Identity; sshKey?: string }
  | { type: 'event'; agentId: string; event: AgentEvent }
  // Sent once after `sync` has been answered in full; events after this are happening now.
  | { type: 'synced' }
  // A terminal agent's screen, sent to clients that have it open: recent scrollback and the
  // visible rows, with ANSI colour and style codes left in, and where the cursor is within it.
  | { type: 'term'; agentId: string; screen: string; cursor: { row: number; col: number } }
  // A request from this client could not be carried out.
  | { type: 'failed'; message: string };

/** Client -> server. */
export type ClientMessage =
  // First message of a connection: asks for the state and every agent's history.
  | { type: 'sync' }
  // This phone's push token, so the device can tell it when an agent needs attention.
  | { type: 'register_push'; token: string }
  | { type: 'set_identity'; name: string; email: string }
  | { type: 'create_project'; name: string; repo: string }
  | { type: 'set_lan'; projectId: string; allow: boolean }
  // Removes the project's files and every agent in it.
  | { type: 'delete_project'; projectId: string }
  | { type: 'create_agent'; projectId: string; name: string; harness: Harness; mode: Mode; worktree: boolean }
  // Stops the agent and removes its history and, if it has one, its worktree. Its branch is kept.
  | { type: 'delete_agent'; agentId: string }
  | { type: 'prompt'; agentId: string; text: string }
  | { type: 'approve'; agentId: string; id: string; allow: boolean }
  | { type: 'set_mode'; agentId: string; mode: Mode }
  // Start and stop receiving a terminal agent's screen. `cols` and `rows` are what fits the viewer.
  | { type: 'term_open'; agentId: string; cols: number; rows: number }
  | { type: 'term_close'; agentId: string }
  // Types `text`, then presses `key`.
  | { type: 'term_input'; agentId: string; text?: string; key?: TermKey };
