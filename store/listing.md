# Store listing

What goes in the App Store and Google Play listings for Toto, kept here so both stay the same
and changes are reviewed like code. Screenshots are in `store/screenshots/`, taken from the
app's demo (`toto://demo`).

## Name

Toto: agents at home

(App Store: 30 characters at most. Google Play: 30.)

## Subtitle (App Store, 30 characters) / short description (Google Play, 80)

- App Store: `Your coding agents, always on`
- Google Play: `Run coding agents on a box at home. Approve what they do from your phone.`

## Description

Toto is a small box on your own network, a Raspberry Pi or any Linux machine, that runs your coding agents around the clock. This app is how you talk to it.

Shut the laptop. Your agents carry on, and ask your phone when they need you.

WHAT YOU CAN DO

• Start agents in your git repositories and tell them what to do.
• Read what each one is doing as it works: every file it reads, every command it runs.
• Allow or deny anything risky with one tap. Or put an agent on full auto.
• Get a notification when an agent stops to ask, and when one finishes.
• See the screenshots your agents take, and send them pictures.
• Open a terminal on your Toto and type into it from your phone.
• Share a Toto with another phone or a browser by scanning a code, and take that access back whenever you like.

YOURS, ALL THE WAY DOWN

• Your hardware, your Claude account, your code. There is no Toto account to create.
• Everything between your phone and your Toto is encrypted end to end. Away from home it passes through a relay that cannot read any of it. You can run your own relay.
• Each project runs as its own user on the Toto, so agents in one cannot read another's files.
• No advertising, no analytics, no tracking.

WHAT YOU NEED

• A Toto: a Raspberry Pi 4 or 5 flashed with the Toto image, or a Linux machine with Toto installed. Both are free and open source at github.com/stellar-engineering/toto.
• A Claude subscription or an Anthropic API key, for the agents to run on.

No Toto yet? The app has a demo you can look around first.

## Keywords (App Store, 100 characters)

`claude,agent,coding,raspberry pi,terminal,ssh,developer,self-hosted,git,automation`

## Categories

- App Store: Developer Tools (secondary: Productivity)
- Google Play: Tools

## URLs

- Support: https://github.com/stellar-engineering/toto/issues
- Marketing: https://toto.royletron.dev
- Privacy policy: https://toto.royletron.dev/privacy

## Notes for the reviewer

Toto controls a device the user owns, so most of the app needs one. To review it without:

1. On the first screen, tap "No Toto yet? Look around a demo".
2. This opens a demo Toto that lives inside the app. Every screen is the real one. Open the
   project "webhooks", then the agent "backoff", which is waiting for approval: tap Allow and it
   finishes its work. Send any message to an agent to see the same from the start.
3. Settings (top right) shows the rest. Nothing in the demo leaves the phone.

Permissions:

- Bluetooth is used only by "Find a new Toto nearby", to set up a new device and give it Wi-Fi.
- Local network access is used to connect to the user's own device on their network. It listens
  on an unencrypted WebSocket there; the app encrypts everything it sends over it itself
  (ChaCha20-Poly1305 with keys agreed between the phone and the device).
- Photos are read only when the user picks pictures to send to an agent.

There is no account and no sign-in. "Sign in to Claude" in settings signs the user's own device
in to their own Anthropic account; the app passes a link and a code between the two and keeps
neither.

## App privacy answers

Both stores ask what the app collects. The honest answers:

- **Data collected by the developer: none.** The app sends nothing to us.
- **Data linked to the user, tracking, advertising: none.**
- Push tokens go to the user's own device, which uses Expo's push service to reach Apple or
  Google. Google Play's form counts this as "Device or other IDs", shared with a service
  provider for app functionality, not collected by us.
- Photos the user chooses are sent to the user's own device and nowhere else.
- All data in transit is encrypted. There is no account, so nothing to request deletion of;
  "Forget this Toto" removes everything the app holds.

## Export compliance (App Store)

The app encrypts what it sends end to end, with standard, published algorithms (X25519,
HKDF-SHA256, ChaCha20-Poly1305). It is declared as using only exempt encryption:
`ITSAppUsesNonExemptEncryption` is `false` in `app/app.json`, so App Store Connect does not ask
again with each build. That declaration was made by the person who submits the app, and is
theirs to revisit if the encryption changes or the rules do.
