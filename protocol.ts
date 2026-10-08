// The messages toto-server and its clients exchange. Each travels as JSON inside an encrypted
// frame (see server/src/secure.ts), over a WebSocket to the device or through the relay.
// Types only: always `import type` so neither Node nor Metro resolves this file at runtime.

/** The common event stream every harness adapter maps onto. */
/**
 * A picture in a conversation, by reference: the picture itself stays on the device, and is asked
 * for with `image` when someone wants to look at it.
 */
export type ImageRef = { id: string; mime: string; bytes: number };

/** A file an agent sent, by reference like a picture, and asked for with `file`. */
export type FileRef = { id: string; name: string; mime: string; bytes: number };

export type AgentEvent =
  // `images`: pictures the person sent along with what they said.
  | { type: 'user'; text: string; images?: ImageRef[] }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  // `images`: pictures the tool returned, such as a screenshot. `files`: files the agent sent.
  | { type: 'tool_result'; id: string; output: string; isError: boolean; images?: ImageRef[]; files?: FileRef[] }
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
/** A phone a device was shared with. `pending` until it has used its invitation. */
export type Phone = { id: string; name: string; added: number; pending: boolean };

/**
 * A plugin: something that can be added to this device. `version` is set once it is installed;
 * `latest` when the relay lists a newer one (only a hint: the device checks what it installs).
 * `login` says it needs signing in to, and `signedIn` whether that has been done.
 */
export type Plugin = {
  name: string;
  description: string;
  version?: string;
  latest?: string;
  login?: boolean;
  signedIn?: boolean;
  /** Its sign-in is making a token at `url` and pasting it back, with `plugin_token`, not a code shown here. */
  paste?: { url: string; help: string };
};

/** What a long job on the device (an update, a plugin install) is doing: `task` is 'update' or 'plugin:<name>'. `failed` when it ended badly. */
export type Progress = { task: string; text: string; step?: number; of?: number; failed?: boolean };

export type ClaudeAccount = 'none' | 'subscription' | 'api_key';

/** Who agents' git commits are attributed to. */
export type Identity = { name: string; email: string };

/** Server -> client. */
export type ServerMessage =
  // The full picture, sent in answer to `sync` and again whenever it changes. `name` is what
  // this device is called. `sshKey` is its public key, for the user to add to their git host.
  | {
      type: 'state';
      name: string;
      claude: ClaudeAccount;
      projects: Project[];
      agents: Agent[];
      identity: Identity;
      sshKey?: string;
      /** The version of Toto this device runs; `latest` is set when a newer one has been released. */
      version: string;
      latest?: string;
      /** An update is being installed. The device restarts when it is done. */
      updating: boolean;
      /** The phones this device has been shared with, and whether the phone being told is the one that owns it. */
      phones: Phone[];
      owner: boolean;
      /** Absent from a Toto that predates plugins. */
      plugins?: Plugin[];
      /** A job under way, or one that failed in the last few minutes. */
      progress?: Progress;
    }
  // The answer to `share`: an invitation for one other phone, to hand over out of band (a QR code).
  // It works once, until `expires`, and only to collect that phone's own key.
  | { type: 'invite'; phoneId: string; secret: string; deviceId: string; relayKey: string; address: string; relay: string; name: string; expires: number }
  // The answer to `join`: the secret this phone uses from now on. The invitation is spent.
  | { type: 'joined'; secret: string }
  // The answer to `claude_login`: the page to open to sign in. It ends by showing a code to send back.
  | { type: 'claude_login'; url: string }
  // How a job on the device is going, sent as it changes, so the whole `state` need not be (and so an
  // app that does not know this message is not told its own request has been answered). Absent: no job.
  | { type: 'progress'; progress?: Progress }
  // The answer to `plugin_login`: open `url` and enter `code` there. The device finishes by itself,
  // and says so with a new `state`, or with `failed`.
  | { type: 'plugin_login'; name: string; url: string; code: string }
  // The answer to `image`: piece `at` of `of`, as base64. A picture is too big to send in one message.
  | { type: 'image'; agentId: string; id: string; at: number; of: number; data: string }
  // The answer to `file`, in pieces in the same way.
  | { type: 'file'; agentId: string; id: string; at: number; of: number; data: string }
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
  // Look for a newer release now; and install the one that was found.
  // Owner only: invite another phone, called `name` in the list; and take a phone's access away.
  | { type: 'share'; name: string }
  | { type: 'revoke'; phoneId: string }
  // The only thing an invitation may say: swap it for a key of this phone's own.
  | { type: 'join' }
  // Owner only: add a plugin to this device (or bring it up to date), take it away, and sign in
  // to it or out of it. Signing in is shared by every project on the device.
  | { type: 'plugin_install'; name: string }
  | { type: 'plugin_remove'; name: string }
  | { type: 'plugin_login'; name: string }
  // The other kind of sign-in: a token the person made for themselves. It is tried before it is kept.
  | { type: 'plugin_token'; name: string; token: string }
  | { type: 'plugin_logout'; name: string }
  | { type: 'check_update' }
  | { type: 'update' }
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
  // `images` are ones this client has just sent with `upload`, by the ids it gave them.
  | { type: 'prompt'; agentId: string; text: string; images?: { id: string; mime: string }[] }
  // Ask for a picture from an agent's conversation. It comes back as `image` messages.
  | { type: 'image'; agentId: string; id: string }
  // Ask for a file an agent sent. It comes back as `file` messages.
  | { type: 'file'; agentId: string; id: string }
  // One piece of a picture being sent to an agent: piece `at` of `of`, as base64. The client
  // chooses `id` (16 hex characters) and names it in the `prompt` that follows.
  | { type: 'upload'; id: string; at: number; of: number; data: string }
  // `answers` is for Claude's questions to the user (the AskUserQuestion tool): question text -> the label chosen,
  // several labels joined with ', ' when the question allows more than one.
  | { type: 'approve'; agentId: string; id: string; allow: boolean; answers?: Record<string, string> }
  | { type: 'set_mode'; agentId: string; mode: Mode }
  // Start and stop receiving a terminal agent's screen. `cols` and `rows` are what fits the viewer.
  | { type: 'term_open'; agentId: string; cols: number; rows: number }
  | { type: 'term_close'; agentId: string }
  // Types `text`, then presses `key`, into a terminal this client has open. Sent per keystroke.
  | { type: 'term_input'; agentId: string; text?: string; key?: TermKey };
