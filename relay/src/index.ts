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

// A device counts as online for this long after it was last heard of, and says so again well
// inside that. The slack covers a device whose object was restarted and missed its goodbye.
const FRESH = 30 * 60_000;
const REMIND = 10 * 60_000;

/**
 * How many Totos are online, for the site. One object for the whole relay, told by each device's
 * object when its device connects and leaves. It holds opaque ids and times, nothing else.
 */
export class Stats extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS live (id TEXT PRIMARY KEY, seen INTEGER NOT NULL)');
  }
  seen(id: string) {
    this.ctx.storage.sql.exec('INSERT INTO live (id, seen) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET seen = excluded.seen', id, Date.now());
  }
  gone(id: string) {
    this.ctx.storage.sql.exec('DELETE FROM live WHERE id = ?', id);
  }
  ids(): string[] {
    return this.ctx.storage.sql.exec<{ id: string }>('SELECT id FROM live').toArray().map((row) => row.id);
  }
  count(): number {
    this.ctx.storage.sql.exec('DELETE FROM live WHERE seen < ?', Date.now() - FRESH);
    return this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM live').one().n;
  }
}

const HANDOFF_FOR = 10 * 60_000;
const HANDOFF_BYTES = 4096;

/**
 * Somewhere to leave one sealed message for a browser to collect: how a phone hands a browser
 * its invitation. One object per handoff, named by an id the browser made up and showed the
 * phone. It is written once, read once, and gone in ten minutes either way. What is left here is
 * sealed to a key only the browser holds, so the relay passes it on without being able to read it.
 */
export class Handoff extends DurableObject<Env> {
  async leave(sealed: string): Promise<boolean> {
    if (await this.ctx.storage.get('sealed')) return false;
    await this.ctx.storage.put('sealed', sealed);
    await this.ctx.storage.setAlarm(Date.now() + HANDOFF_FOR);
    return true;
  }
  async collect(): Promise<string | undefined> {
    const sealed = await this.ctx.storage.get<string>('sealed');
    if (sealed) await this.ctx.storage.deleteAll();
    return sealed;
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

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
      await this.present();
    } else if (role === 'client') {
      this.ctx.acceptWebSocket(server, ['client', crypto.randomUUID()]);
      // Accept before refusing, so the client learns why from the close code.
      if (!this.device()) server.close(DEVICE_OFFLINE, 'device offline');
    } else {
      return new Response('bad role', { status: 400 });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Tells the count this device is online, and arranges to say so again while it stays. */
  private async present() {
    await this.env.STATS.getByName('all').seen(this.ctx.id.toString());
    await this.ctx.storage.setAlarm(Date.now() + REMIND);
  }

  async alarm() {
    if (this.device()) await this.present();
  }

  /** Tells the device a release was published, so it looks for itself. */
  nudge() {
    this.device()?.send(JSON.stringify({ t: 'update' }));
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

  async webSocketClose(ws: WebSocket) {
    const [role, clientId] = this.ctx.getTags(ws);
    if (role === 'client') return this.device()?.send(JSON.stringify({ c: clientId, t: 'close' }));
    // A device that was replaced has a successor; only hang up on clients when there is none.
    if (this.ctx.getWebSockets('device').some((other) => other !== ws)) return;
    await this.env.STATS.getByName('all').gone(this.ctx.id.toString());
    for (const client of this.ctx.getWebSockets('client')) client.close(DEVICE_OFFLINE, 'device offline');
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/stats') {
      const live = await env.STATS.getByName('all').count();
      // Briefly cacheable: the site asks every few seconds, from every visitor.
      return Response.json({ live }, { headers: { 'cache-control': 'public, max-age=10' } });
    }
    const handoff = /^\/pair\/([0-9a-f]{32})$/.exec(pathname);
    if (handoff) {
      const box = env.HANDOFF.getByName(handoff[1]);
      if (request.method === 'PUT') {
        const sealed = await request.text();
        if (!sealed || sealed.length > HANDOFF_BYTES) return new Response('too large', { status: 413 });
        return new Response(null, { status: (await box.leave(sealed)) ? 204 : 409 });
      }
      // ponytail: the browser asks every couple of seconds. A WebSocket here would spare the
      // requests if many browsers ever wait at once.
      const sealed = await box.collect();
      return sealed ? new Response(sealed, { headers: { 'cache-control': 'no-store' } }) : new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    // The web app is one page that draws every screen itself, so any address under /app that is
    // not a file is that page.
    if (pathname === '/app' || pathname.startsWith('/app/')) return env.ASSETS.fetch(new Request(new URL('/app/', request.url), request));
    if (pathname === '/release') {
      // The latest release, for the site: GitHub does not let a page ask it directly. Whether the
      // image and the Android app are there too is checked, since they are added to a release some minutes after the rest.
      const latest = 'https://github.com/stellar-engineering/toto/releases/latest/download';
      const cached = { cf: { cacheTtl: 300, cacheEverything: true } };
      const there = (name: string) => fetch(`${latest}/${name}`, { method: 'HEAD', ...cached });
      const [said, image, app] = await Promise.all([fetch(`${latest}/version`, cached), there('toto.img.xz'), there('toto.apk')]);
      const version = said.ok ? (await said.text()).trim() : '';
      if (!/^\d+\.\d+\.\d+$/.test(version)) return Response.json({}, { status: 502 });
      return Response.json(
        {
          version,
          image: image.ok ? { url: `${latest}/toto.img.xz`, bytes: Number(image.headers.get('content-length')) || undefined } : undefined,
          android: app.ok ? { url: `${latest}/toto.apk` } : undefined,
        },
        { headers: { 'cache-control': 'public, max-age=300' } },
      );
    }
    if (pathname === '/announce' && request.method === 'POST') {
      // From the release workflow. The key is a secret (wrangler secret put ANNOUNCE_KEY), so it is not in the generated Env.
      const key = (env as { ANNOUNCE_KEY?: string }).ANNOUNCE_KEY?.trim();
      const given = request.headers.get('authorization')?.replace(/^Bearer /, '').trim() ?? '';
      if (!key || (await sha256(given)) !== (await sha256(key))) return new Response('Not allowed', { status: 403 });
      // ponytail: one call per device from this one request, which Cloudflare caps (50 on the free
      // plan). Past that, fan out in batches from the counting object's alarm; every Toto also
      // looks for itself once a day, so the ones this misses only find out later.
      const ids = (await env.STATS.getByName('all').ids()).slice(0, 40);
      await Promise.allSettled(ids.map((id) => env.DEVICE.get(env.DEVICE.idFromString(id)).nudge()));
      return Response.json({ told: ids.length });
    }
    const match = /^\/v1\/([0-9a-f]{32})$/.exec(pathname);
    if (!match) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    return env.DEVICE.getByName(match[1]).fetch(request);
  },
} satisfies ExportedHandler<Env>;
