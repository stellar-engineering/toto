# Toto: Plan

Formalises [SPEC.md](SPEC.md) from the decisions agreed on 2026-10-06.

## Decisions

| Area | Decision |
|---|---|
| Audience | Consumer product, open source, free for now |
| Distribution | User flashes a downloadable image (aim for a Raspberry Pi Imager listing) |
| Hardware | Pi 4 and Pi 5, 4GB+ |
| Harnesses | Claude Code, Codex CLI, Gemini CLI |
| Interaction | Native chat UI per harness, raw terminal as fallback |
| Clients | React Native (Expo) first; web build from the same codebase after mobile |
| Onboarding | Bluetooth from the mobile app: Wi-Fi credentials plus key exchange |
| Identity | Pairing only, no accounts; relay designed so accounts can be added later |
| Remote access | Our hosted Cloudflare relay, same code self-hostable |
| Relay privacy | End-to-end encrypted; relay forwards ciphertext only |
| Projects | A project = one cloned git repo + one dedicated Linux user. Many agents per project |
| Agent concurrency | Git worktree per agent by default; user can attach an agent to the main checkout |
| Config scope | Device-wide defaults (keys, MCP, GitHub), per-project overrides |
| LAN access | Blocked per project user by default, per-project switch to allow |
| Approvals | Per agent: "ask me" (push notification with approve/deny) or "full auto" |
| Model auth | API keys, plus subscription login for each provider |
| Browser | Headless Chromium via a browser MCP server; screenshots shown in chat |
| Updates | CLIs auto-update; Toto server updates on user tap from signed releases; OS security patches unattended |
| MCP setup | Full marketplace (browse, search, install) |
| Pi server | TypeScript on Node |

## Architecture

Three pieces, one TypeScript monorepo with a shared protocol package.

**1. Pi server (`toto-server`)**: a single Node service running as root-owned systemd unit, which:
- manages projects: creates the Linux user, clones the repo, applies the firewall rule (nftables match on the user's uid, dropping private ranges), creates worktrees
- runs agents as the project user, each inside a tmux session so they survive restarts and disconnects
- has one adapter per harness that turns its structured output into a common event stream (message, tool call, approval request, result); the tmux pane is the terminal fallback
- stores config and secrets, and writes MCP config into each harness's own format
- exposes one WebSocket API, used identically over LAN and through the relay
- runs the Bluetooth provisioning service until the device is paired

**2. App (`toto-app`)**: Expo, covering onboarding, projects, agents (chat and terminal views), approvals, settings and the MCP marketplace. Finds the Pi by mDNS on the LAN and falls back to the relay.

**3. Relay (`toto-relay`)**: a Cloudflare Worker with one Durable Object per device. The Pi holds an outbound WebSocket; clients connect to the same object and frames are forwarded. It also stores push tokens and sends content-free "your agent needs you" pushes. Deployable to a user's own Cloudflare account unchanged.

**Security model**
- Pairing over Bluetooth exchanges public keys; every later connection (LAN or relay) is authenticated and encrypted with them.
- Extra devices and browsers are added by scanning a QR code from an already-paired phone.
- Isolation boundary is the project's Linux user. Agents within a project trust each other; projects cannot read each other's files or credentials.

## Milestones

**M0: Walking skeleton.** Install script on stock Raspberry Pi OS. Claude Code only, one hard-coded project, chat over LAN WebSocket, Expo app connecting by hostname. Proves the adapter and event protocol.

**M1: Projects and agents.** Project lifecycle (Linux user, GitHub connect via device flow, clone, worktrees). Multiple agents per project. tmux terminal view. Codex and Gemini adapters. Ask/full-auto modes with in-app approvals.

**M2: Onboarding.** Flashable image (pi-gen). Bluetooth Wi-Fi provisioning and key exchange. API key entry. Subscription login for each provider.

**M3: Remote.** Relay Worker and Durable Object, end-to-end encryption, push notifications for approvals and completion, self-host docs.

**M4: Consumer readiness.** Update mechanism, LAN firewall, headless browser MCP, device-default/project-override config UI, MCP marketplace.

**M5: Web and launch.** Web build with QR pairing, Pi Imager listing, app store releases, public repo.

## Risks and open questions

- **Subscription login terms.** Each provider's terms on using a consumer subscription from a third-party harness need checking before M2; API keys are the fallback if any say no.
- **Consumer vs self-flash.** Flashing an SD card caps the audience at fairly technical users. Revisit pre-flashed cards once there is demand.
- **4GB Pi 4.** Chromium plus several concurrent agents may not fit. Measure in M1 and set a concurrent-agent limit by RAM.
- **Marketplace scope.** A full marketplace is a product in itself. Which registry backs it, and how are servers vetted for a consumer audience? Deliberately last in M4; a curated list would unblock launch if it slips.
- **Bluetooth on the Pi.** A BlueZ GATT service from Node and BLE on both mobile platforms is the least proven part; spike it early in M2.
- **Three adapters.** Harness output formats change often. Terminal fallback is the safety net when an adapter breaks.
- **Not yet decided:** relay rate limits and abuse handling, backup/restore of a device, factory reset and re-pairing after a lost phone, telemetry and crash reporting.
