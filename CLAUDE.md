# Toto

An always-on agent harness: a server on a Raspberry Pi or Linux box runs coding agents, a phone app talks to it, and a relay connects the two away from home. `README.md` is the map for people; this is what an agent working here needs beyond it. `PLAN.md` has the decisions and what is next.

This repository is public. Never commit a hostname, address, token or network name from a real machine, and keep them out of examples and tests.

## Layout

- `protocol.ts`: the messages app and server exchange. Types only, imported with `import type`.
- `server/`: runs on the Toto as the unprivileged `toto` user. Node 24 running TypeScript directly (type stripping, so erasable syntax only: no enums, no parameter properties).
- `bin/`: what runs as root. `toto-priv` (the only thing the server may `sudo`), `toto-update.mjs` (the updater), `toto-firstboot`.
- `app/`: Expo and React Native. Read `app/AGENTS.md` first: fetch the Expo docs before using an Expo API.
- `relay/`: a Cloudflare Worker with two Durable Objects (`Device`, `Stats`). It also serves `site/`.
- `site/`: plain HTML, one stylesheet, one script. No build step. `site/app/` is the app built for the browser (`cd app && npx expo export -p web`, then copy `dist` there); it is generated and git-ignored.
- The app runs on phones and in a browser. Anything native-only has a `.web.ts` twin beside it (`storage`, `push`, `ble`); a browser reaches a Toto through the relay only.
- `image/`: builds the flashable Pi image by customising Raspberry Pi OS Lite.

## Checks to run

| Changed | Run |
| --- | --- |
| `server/`, `bin/`, `protocol.ts` | `cd server && npm run typecheck && npm test` |
| `app/` | `cd app && npx tsc --noEmit && npx expo lint` |
| `relay/` | `cd relay && npm run typecheck` (regenerates `worker-configuration.d.ts` from `wrangler.jsonc`) |
| `site/` | `cd relay && npx wrangler dev`, then look at it at desktop and phone widths |
| shell scripts | `bash -n <file>` |

Tests are `node --test`, next to the code as `*.test.ts` or `*.test.mjs`. No test framework.

## Rules that are easy to break

- **Two files exist twice and must stay identical:** `secure.ts` and `moods.ts`, in `server/src` and `app/src`. A test fails if they drift. Change both.
- **Every branch of the `case` in `bin/toto-priv` must end in `exit` or `exec`.** One that does not falls through into the project-user check and fails with "bad user name". This shipped once. `server/src/priv.test.mjs` runs the helper for real; add a case there for any new verb.
- **Secrets never go on a command line or through `sudo`'s environment**, because both are logged and visible to other users. They go on stdin or in a private file (`~/.toto-env` for agents).
- **Nothing prints the device token except to a terminal.** `install.sh` is also run by the updater, whose output is kept in the system log.
- **The server is the network-facing part and is not trusted with root.** `toto-priv` validates every argument itself. The updater takes no arguments at all: where it downloads from and which key it trusts are its own.
- **After adding a package to `app/`, refresh its lockfile with the npm the workflows use:** `npx npm@11 install --package-lock-only --ignore-scripts`. `expo install` on a Mac writes one that a clean install on Linux rejects, and the deploy and release workflows fail at `npm ci`.
- **A new message type needs both ends.** Add it to `protocol.ts`, handle it in `server/src/index.ts`, and remember older servers answer unknown types with a `failed` message, and older apps ignore unknown server messages.
- **The relay is never believed.** It forwards sealed frames and hints ("a release exists"). Anything it says is checked by the device.
- **Project users have UIDs 50000 to 59999.** The helper refuses to delete anything outside that range.

## Style

- The least code that works. No abstraction with one user, no option nobody sets.
- A deliberate shortcut gets a `ponytail:` comment saying what its ceiling is and what to do when it is reached.
- Comments say why, in plain sentences. Match the density of the file you are in.
- Non-trivial logic leaves one runnable check behind.
- User-facing text: plain verbs, sentence case, says what happened and what to do. The app and site are terminal-styled: IBM Plex Mono, the palette in `app/src/theme.ts` and `site/toto.css`, amber for whatever is yours or waiting on you.
- The mark is the dog `/o o\` over a `•` nose. It moves by replacing characters, never by transforming them. Frames live in `moods.ts`.

## Releasing

1. Bump `version` in `server/package.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match).

`.github/workflows/release.yml` then tests, bundles, signs with the `RELEASE_KEY` secret, publishes the release, tells online Totos, builds the image, and builds the Android APK if there is an `EXPO_TOKEN` secret. The private signing key exists only as that secret. `release.pub` is its public half; changing it strands every Toto already out there.

A release reaches real devices as root. Before tagging, run the changed path on a real Linux install, not only the tests.

## Deploying the site and relay

`.github/workflows/deploy.yml` deploys both when `site/` or `relay/` changes on main, if there is a `CLOUDFLARE_API_TOKEN` secret. By hand: `cd relay && npx wrangler deploy`.

Totos hold a connection to the relay. A deploy does not drop them, but a change to the frame format between relay and device must keep working with servers already installed.

## Testing on hardware

- The updater can be exercised without the real key: swap `/opt/toto/release.pub` for a throwaway one, serve a bundle locally, and run it as root with `TOTO_RELEASES=http://127.0.0.1:<port>`.
- Do not test joining Wi-Fi on a machine whose only connection is Wi-Fi.
- A machine running Toto may run other things. Check agents are idle before restarting `toto.service`, and never kill or delete by user id or user name.
- The image has no SSH. What it does on first boot can only be seen on its display or through the app.

## Git

Branch before committing if on main. Commit messages: a short imperative subject, then why.
