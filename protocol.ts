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

// --- Setting a device up over Bluetooth, before the phone can reach it any other way.

/** What a device says about itself to anyone nearby, before any key is exchanged. */
export type SetupInfo = {
  /** The id this device is known by at the relay and in the app. */
  id: string;
  name: string;
  /** Whether it already has an owner. If so, only a phone holding its token can go further. */
  claimed: boolean;
  /** The Wi-Fi network it is on, if any. */
  wifi: string | null;
};

export type WifiNetwork = { ssid: string; signal: number; secure: boolean };

/** Phone -> device. */
export type SetupRequest =
  // `country` is where the phone thinks it is (two letters). A new Pi needs to be told before
  // its Wi-Fi radio will switch on, and it has no other way to find out.
  | { type: 'networks'; country?: string }
  | { type: 'join'; ssid: string; password: string }
  // Asks for what the app needs to add this device: the answer is its way of handing over the keys.
  | { type: 'claim' };

/** Device -> phone. */
export type SetupReply =
  | { type: 'networks'; list: WifiNetwork[]; current: string | null }
  | { type: 'joined'; ok: boolean; problem?: string }
  | { type: 'claimed'; name: string; address: string; token: string; relay: string }
  | { type: 'refused'; problem: string };

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

/** A key with no character of its own. `ctrl-` takes any letter, as in `ctrl-c`. */
export type TermKey =
  | 'enter' | 'tab' | 'escape' | 'backspace'
  | 'up' | 'down' | 'left' | 'right'
  | 'home' | 'end' | 'pageup' | 'pagedown'
  | `ctrl-${string}`;

/** How this device's agents are signed in to Claude, if they are. */
export type ClaudeAccount = 'none' | 'subscription' | 'api_key';

/** Who agents' git commits are attributed to. */
export type Identity = { name: string; email: string };

/** Server -> client. */
export type ServerMessage =
  // The full picture, sent in answer to `sync` and again whenever it changes. `name` is what
  // this device is called. `sshKey` is its public key, for the user to add to their git host.
  | { type: 'state'; name: string; claude: ClaudeAccount; projects: Project[]; agents: Agent[]; identity: Identity; sshKey?: string }
  // The answer to `claude_login`: the page to open to sign in. It ends by showing a code to send back.
  | { type: 'claude_login'; url: string }
  // The answer to `ping`: this device is here, and this is what it is called.
  | { type: 'pong'; name: string }
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
  // First message of a connection that only wants to know the device is there.
  | { type: 'ping' }
  | { type: 'rename_device'; name: string }
  // Signing in to Claude with a subscription takes two steps: ask for the sign-in page, then
  // send back the code that page shows.
  | { type: 'claude_login' }
  | { type: 'claude_code'; code: string }
  // Or use an API key instead.
  | { type: 'claude_key'; key: string }
  | { type: 'claude_logout' }
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
  // Types `text`, then presses `key`, into a terminal this client has open. Sent per keystroke.
  | { type: 'term_input'; agentId: string; text?: string; key?: TermKey };
