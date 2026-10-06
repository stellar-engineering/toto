// The Toto relay: lets a client away from home reach a device that can only make outbound
// connections. One Durable Object per device holds the device's WebSocket and its clients', and
// passes frames between them. The frames are end-to-end encrypted, so the relay sees who is
// talking to which device and how much, never what.
//
// ponytail: no rate limits or quotas yet. Before this is open to the public it needs a cap on
// connections and messages per device.
import { DurableObject } from 'cloudflare:workers';

// Close codes the two ends can act on.
const REPLACED = 4000; // this device connected again from elsewhere
const DEVICE_OFFLINE = 4404;
const CLOSED_BY_DEVICE = 4002;
const MAX_FRAME = 256 * 1024;

const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export class Device extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered without waking the object, so heartbeats cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const key = await sha256(url.searchParams.get('k') ?? '');

    // The first device to connect under an id sets its key. After that the device and its
    // clients must all present it, so nobody else can take the device's place or reach it.
    const claimed = await this.ctx.storage.get<string>('key');
    if (role === 'device' && !claimed) await this.ctx.storage.put('key', key);
    else if (claimed !== key) return new Response('forbidden', { status: 403 });

    const [client, server] = Object.values(new WebSocketPair());
    if (role === 'device') {
      for (const old of this.ctx.getWebSockets('device')) old.close(REPLACED, 'replaced');
      // Their sessions were with the old connection; they reconnect and start fresh.
      for (const ws of this.ctx.getWebSockets('client')) ws.close(DEVICE_OFFLINE, 'device reconnected');
      this.ctx.acceptWebSocket(server, ['device']);
    } else if (role === 'client') {
      this.ctx.acceptWebSocket(server, ['client', crypto.randomUUID()]);
      // Accept before refusing, so the client learns why from the close code.
      if (!this.device()) server.close(DEVICE_OFFLINE, 'device offline');
    } else {
      return new Response('bad role', { status: 400 });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The device's live connection. During a handover the newest is last. */
  private device(): WebSocket | undefined {
    return this.ctx.getWebSockets('device').findLast((ws) => ws.readyState === WebSocket.OPEN);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > MAX_FRAME) return ws.close(1009, 'frame too large');
    const [role, clientId] = this.ctx.getTags(ws);

    if (role === 'client') {
      const device = this.device();
      if (!device) return ws.close(DEVICE_OFFLINE, 'device offline');
      return device.send(JSON.stringify({ c: clientId, m: message }));
    }

    // From the device: { c, m } is a frame for one client, { c, t: 'close' } hangs up on it.
    let msg: { c?: unknown; t?: unknown; m?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof msg.c !== 'string') return;
    const target = this.ctx.getWebSockets(msg.c)[0];
    if (msg.t === 'close') return target?.close(CLOSED_BY_DEVICE, 'closed by device');
    if (!target) return ws.send(JSON.stringify({ c: msg.c, t: 'close' }));
    if (typeof msg.m === 'string') target.send(msg.m);
  }

  webSocketClose(ws: WebSocket) {
    const [role, clientId] = this.ctx.getTags(ws);
    if (role === 'client') return this.device()?.send(JSON.stringify({ c: clientId, t: 'close' }));
    // A device that was replaced has a successor; only hang up on clients when there is none.
    if (this.ctx.getWebSockets('device').some((other) => other !== ws)) return;
    for (const client of this.ctx.getWebSockets('client')) client.close(DEVICE_OFFLINE, 'device offline');
  }

  webSocketError(ws: WebSocket) {
    this.webSocketClose(ws);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = /^\/v1\/([0-9a-f]{32})$/.exec(new URL(request.url).pathname);
    if (!match) return new Response('Toto relay', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    return env.DEVICE.getByName(match[1]).fetch(request);
  },
} satisfies ExportedHandler<Env>;
