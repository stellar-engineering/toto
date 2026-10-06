import { bytesToHex } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { Agent, AgentEvent, ClientMessage, Identity, Project, ServerMessage } from '../../protocol';
import { type Frame, NONCE_BYTES, keysFromToken, session } from './secure';

type Session = ReturnType<typeof session>;
type Route = 'local' | 'relay';
const CONNECT_TIMEOUT = 5_000;
const DEVICE_OFFLINE = 4404; // the relay's close code for "that device is not connected"

export type { Agent, AgentEvent, ClientMessage, Harness, Identity, Mode, Project, TermKey } from '../../protocol';

type Connection = {
  status: 'idle' | 'connecting' | 'open';
  /** Why we are not connected, when there is something to say. */
  notice: string;
  /** How the open connection reaches the device. */
  via: Route;
  /** `address` is the device on the local network; `relay`, if given, is tried when that fails. */
  connect: (address: string, token: string, relay: string) => void;
  post: (message: ClientMessage) => void;
  /** Like `post`, for requests that take a while. `busy` stays true until the server answers. */
  request: (message: ClientMessage) => void;
  busy: boolean;
  projects: Project[];
  agents: Agent[];
  /** Who agents' commits are attributed to. */
  identity?: Identity;
  /** The device's public SSH key, when it has one. */
  sshKey?: string;
  /** Each agent's history, by agent id. */
  events: Record<string, AgentEvent[]>;
  /** The screen of each terminal agent this device has open, by agent id. */
  screens: Record<string, string>;
};

const Context = createContext<Connection | null>(null);

export const useConnection = () => {
  const value = useContext(Context);
  if (!value) throw new Error('useConnection outside ConnectionProvider');
  return value;
};

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Connection['status']>('idle');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sshKey, setSshKey] = useState<string>();
  const [identity, setIdentity] = useState<Identity>();
  const [events, setEvents] = useState<Connection['events']>({});
  const [screens, setScreens] = useState<Connection['screens']>({});
  const [via, setVia] = useState<Route>('local');
  const socket = useRef<{ send: (message: ClientMessage) => void } | null>(null);

  const receive = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'state':
        setProjects(msg.projects);
        setAgents(msg.agents);
        setSshKey(msg.sshKey);
        setIdentity(msg.identity);
        setBusy(false);
        break;
      case 'event':
        // ponytail: copies the agent's history per event, which is slow when replaying a long one.
        // Batch the replay when that shows.
        setEvents((all) => ({ ...all, [msg.agentId]: [...(all[msg.agentId] ?? []), msg.event] }));
        break;
      case 'term':
        setScreens((all) => ({ ...all, [msg.agentId]: msg.screen }));
        break;
      case 'failed':
        setBusy(false);
        Alert.alert('That did not work', msg.message);
        break;
    }
  };

  /**
   * Opens one encrypted connection. `onFail` fires if it never got as far as hearing from the
   * device; once it has, losing it is reported as a lost connection instead.
   */
  const open = (url: string, psk: Uint8Array, route: Route, onFail: (deviceOffline: boolean) => void) => {
    const ws = new WebSocket(url);
    const nonce = bytesToHex(getRandomValues(new Uint8Array(NONCE_BYTES)));
    let secure: Session | undefined;
    let live = false;
    const giveUp = setTimeout(() => ws.close(), CONNECT_TIMEOUT);
    const sealed = (message: ClientMessage) =>
      ws.send(JSON.stringify({ t: 'data', b: secure!.seal(JSON.stringify(message)) } satisfies Frame));

    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', n: nonce } satisfies Frame));
    ws.onmessage = (m) => {
      try {
        const frame: Frame = JSON.parse(m.data);
        if (frame.t === 'hello' && !secure) {
          secure = session(psk, 'client', nonce, frame.n);
          return sealed({ type: 'sync' });
        }
        if (frame.t !== 'data' || !secure) throw new Error('unexpected frame');
        const msg: ServerMessage = JSON.parse(secure.open(frame.b));
        if (!live) {
          // A frame that opens proves the other end is our device, not just something at that address.
          live = true;
          clearTimeout(giveUp);
          socket.current = { send: sealed };
          setVia(route);
          setStatus('open');
        }
        receive(msg);
      } catch {
        ws.close();
      }
    };
    ws.onclose = (e) => {
      clearTimeout(giveUp);
      if (!live) return onFail(e.code === DEVICE_OFFLINE);
      socket.current = null;
      setBusy(false);
      setNotice('Connection lost.');
      setStatus('idle');
    };
  };

  const connect = (address: string, token: string, relay: string) => {
    setStatus('connecting');
    setNotice('');
    setEvents({}); // the device replays every history on connect
    const { psk, deviceId, relayKey } = keysFromToken(token.trim());
    const fail = (notice: string) => {
      setNotice(notice);
      setStatus('idle');
    };
    // The local network first, since it is faster and works with no internet; then the relay.
    open(address.trim(), psk, 'local', () => {
      if (!relay.trim()) return fail('Could not connect. Check the address and token.');
      open(`${relay.trim().replace(/\/$/, '')}/v1/${deviceId}?role=client&k=${relayKey}`, psk, 'relay', (deviceOffline) =>
        fail(deviceOffline ? 'Your Toto is not connected to the relay. Is it switched on?' : 'Could not connect. Check the addresses and token.'),
      );
    });
  };

  const post = (message: ClientMessage) => socket.current?.send(message);
  const request = (message: ClientMessage) => {
    setBusy(true);
    post(message);
  };

  return (
    <Context.Provider value={{ status, notice, via, connect, post, request, busy, projects, agents, identity, sshKey, events, screens }}>
      {children}
    </Context.Provider>
  );
}
