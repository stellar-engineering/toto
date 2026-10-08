# Toto: Plan

What Toto is lives in [SPEC.md](SPEC.md). This is what has been decided, what is built, and what is left. Last updated 2026-10-07 (after the first Pi install).

## Where things stand

| Milestone | State |
|---|---|
| M0: Walking skeleton | Done |
| M1: Projects and agents | Done, except the Codex and Gemini chat adapters (deferred) |
| M3: Remote access | Done on Android. iOS push is waiting on an Apple developer account |
| M2: Onboarding | Bluetooth setup done and run on a Pi 4. Image, pairing mode and local tools in progress |
| M4: Consumer readiness | Local-network firewall done; the rest not started |
| M5: Web and launch | Not started |

M3 was done before M2 because a working box already existed and reaching it from outside the house was the bigger gap.

## Decisions

| Area | Decision |
|---|---|
| Audience | Consumer product, open source, free for now |
| Distribution | User flashes a downloadable image (aim for a Raspberry Pi Imager listing) |
| Hardware | Pi 4 and Pi 5, 4GB+. Developed on a Debian 13 x86 machine; first run on a Pi 4 (4GB) on 2026-10-07 |
| Harnesses | Claude Code as a chat today. Codex CLI and Gemini CLI later; both usable now by hand in a terminal agent |
| Interaction | Native chat per harness, with terminal agents as the fallback |
| Clients | One Expo app. Mobile first; web build from the same code later |
| Onboarding | Bluetooth from the mobile app: the phone finds a new Toto, puts it on Wi-Fi and collects its keys. Typing an address and token remains as a fallback |
| Pairing mode | A Toto advertises over Bluetooth only until it has an owner. After that, pairing mode is turned on by hand at the device, or by itself if the device loses its network |
| Identity | Pairing only, no accounts |
| Remote access | Hosted Cloudflare relay at `toto.royletron.dev`, same code self-hostable |
| Privacy | Every connection is end-to-end encrypted, on the local network and through the relay |
| Projects | A project = one cloned git repo + one dedicated Linux user. Many agents per project |
| Agent concurrency | Git worktree per agent by default; an agent can share the main checkout instead |
| Local network | Blocked per project by default, with a per-project switch |
| Approvals | Per agent: asks first (with a push notification) or full auto. Switchable mid-conversation |
| Model auth | An API key or a Claude subscription token, set in the device's environment file |
| Git access | One SSH key per device, shown in the app to add to a git host |
| Push | Sent by the device through Expo's push service, with fixed text and no content |
| Server | TypeScript on Node 24, run directly with no build step |
| Design | Terminal-styled: one monospace face, dark only, amber for the user and for agents waiting on them |
| Mark | A dog in six characters, `/o o\\` over a bullet nose, animated by swapping characters, with a mood per state. Shown throughout the app and on the device's own console |
| App identity | `com.stellar.toto`, Expo project `@stellar-engineering/toto` |

## How it is built

One repository, three parts, with the message types shared in [protocol.ts](protocol.ts).

**Device server (`server/`).** A single Node service, run by systemd as the unprivileged user `toto`.
- Reaches root only through [bin/toto-priv](bin/toto-priv), which can create or delete a project's Linux user and open or close the local network to it. Project users get ids from 50000 up.
- Runs each chat agent as a child process under the project's user, speaking Claude Code's streaming JSON. A conversation resumes from its session id after a restart; a turn in flight is lost.
- Runs each terminal agent as a tmux session under the project's user. tmux is the terminal emulator: the server sends its finished screen whenever it changes and takes keystrokes one at a time.
- Gives agents their credentials through a private file in the project user's home, never through sudo, which logs what it is handed.
- Keeps state in one JSON file and one append-only log per agent, under `/var/lib/toto`.
- Listens on the local network and holds one outbound connection to the relay. Both carry the same encrypted frames.

**App (`app/`).** Expo with Expo Router. Remembers its Toto in secure storage, connects on launch, tries the local network first and falls back to the relay, and reconnects without losing your place. Chat renders markdown with highlighted code; terminals render colour and take typing key by key.

**Relay (`relay/`).** A Cloudflare Worker with one Durable Object per device, forwarding frames it cannot read between a device and its clients. See [relay/README.md](relay/README.md) to run your own.

**Encryption.** Each connection opens with a handshake of fresh nonces, then carries frames sealed with ChaCha20-Poly1305 under a per-direction counter, so forged, replayed and reordered frames fail. Keys are derived from the shared token.

## What is left

### M2: Onboarding
- Done: Bluetooth setup. The device offers a Bluetooth service through BlueZ; phone and device exchange keys and the phone lists and joins Wi-Fi and collects the device's keys. Run end to end on a Pixel against a Pi 4, except for joining a network.
- Flashable image: the smallest official Raspberry Pi OS with Toto already installed, a token made on first boot, and a console screen in place of a login.
- A local tool on the device (`toto`): status with the mark alive, pairing mode, Wi-Fi and rename.
- Per-device keys from pairing. This also gives the relay path forward secrecy, which the shared token does not.
- Adding further devices by scanning a code from a paired phone.
- Finding the device on the local network by itself (mDNS).
- In-app sign-in for Claude, replacing hand-editing `/etc/toto.env`. Other providers follow with their adapters.
- Check each provider's terms on using a consumer subscription from a third-party harness before offering it to customers.

### M3: leftovers
- iOS push, once there is an Apple developer account to build with.
- A notification icon, and a short explanation before the permission prompt.
- Rate limits and quotas on the relay before its address is public.

### M4: Consumer readiness
- Updates: the agent CLIs by themselves, Toto's server on a tap from signed releases, OS security patches unattended.
- Done: a headless browser for chat agents. Chromium on the device, driven by the Chrome DevTools MCP server, with a skill on using it, both in a plugin the server hands to Claude (`server/plugins/browser`). Not yet measured on a Pi 4, and terminal agents do not get it.
- MCP setup: a curated list first, with a fuller marketplace after.
- Per-project overrides for credentials and MCP servers.
- Codex and Gemini chat adapters. Full auto is straightforward for both; asking for approval needs each tool's richer host mode (`codex app-server`, Gemini's ACP), which is unproven.

### M5: Web and launch
- A site that says what Toto is, with documentation and a live count of Totos online.
- Web build of the app, paired by scanning a code.
- Pi Imager listing, app store releases, public repository.

## Known limits

- **First setup trusts whoever is nearby.** Until a Toto has an owner, any phone in Bluetooth range can claim it; a Pi has no screen to confirm on.
- **One shared token.** Anyone holding it has full control, and recorded traffic could be decrypted later by someone who obtained it. Fixed by M2 pairing.
- **Loopback is open to agents.** The firewall keeps agents off the local network but cannot separate their own `127.0.0.1` from services on the device listening there. Closing that needs a network namespace per project.
- **One SSH key for everything.** Added to a git account, it gives every project's agents every repository that account can reach. Per-repository deploy keys would be tighter.
- **Firewall rules are re-applied only at server start.** If something else wipes them while the server runs, they stay gone until it restarts.
- **Histories are replayed whole on connect** and held in memory on both ends. This will need paging once conversations are long.
- **Terminals are screen snapshots,** not a byte stream: very fast output is sampled, and each update resends the screen.
- **No light theme, and no web or tablet layout.**

## Undecided

- Backup and restore of a device, factory reset, and re-pairing after a lost phone.
- Telemetry and crash reporting.
- Whether to ship pre-flashed cards, since flashing limits the audience to fairly technical users.
- Whether 4GB is enough for a browser plus several agents; needs measuring on a Pi 4.
