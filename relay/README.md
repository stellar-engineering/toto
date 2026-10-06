# Toto relay

Lets the Toto app reach a device from outside its local network. The device keeps one outbound
WebSocket open to the relay; the app connects to the same place and the relay passes frames
between them. Frames are end-to-end encrypted, so the relay cannot read them.

## Run your own

You need a Cloudflare account. The free plan is enough.

```
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints the relay's address, like `https://toto-relay.<you>.workers.dev`. Use it with
`wss://` in place of `https://`:

- On the device, set `TOTO_RELAY_URL=wss://…` in `/etc/toto.env`, then `sudo systemctl restart toto`.
- In the app, enter the same address as the relay address.

## Develop

`npm run dev` runs it locally on `ws://localhost:8787`.
