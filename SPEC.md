# TOTO: Agent Machine

Toto is an always on agent harness, you provide the hardware, the API keys for your preferred agents, config for your favorite MCP/Plugins and plug it in and go. Toto at it's heart is a pre-configure RaspberryPI that sits on your local network running your agents, streaming your chats to your phone/computer - turn off your laptop and Toto carries on!

## Tech Stack

TBD but we want a Raspbian image that a user can just flash onto their RaspberryPI, once it boots we want all of the configuration to happen on a mobile app - so maybe via bluetooth in the first instance and then connecting to the local network. The image needs the following:

- All of the agent harnesses/providers a user could want
- A browser
- A configurable MCP stack
- A server for configuration and streaming input/output

## The APP

Probably React native, but it needs to allow the user to do all of the configuration, from registering their PI via BlueTooth to providing API keys to interacting with their agents

### Web APP

Ideally we also want to expose what the app can do to people via a browser - things like BlueTooth won't be as easy so we will need some sort of basic access control once the PI is registered.

## Outside the home

Ideally, when the user leaves their local network we want to provide something that will tunnel through so they can securely connect to their PI from wherever they are. We use a lot of Cloudflare infra, so if there is something we can host - or even have the user self host if they are that way inclined. It should be as thin as possible - so not a fully fledged service but more of a forwarding service.
