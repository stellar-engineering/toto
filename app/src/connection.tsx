import { bytesToHex } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { Agent, AgentEvent, ClientMessage, Identity, Project, ServerMessage } from '../../protocol';
import { pushToken } from './push';
import { type Frame, NONCE_BYTES, keysFromToken, session } from './secure';

export type { Agent, AgentEvent, ClientMessage, Harness, Identity, Mode, Project, TermKey } from '../../protocol';

type Session = ReturnType<typeof session>;
type Route = 'local' | 'relay';
/** How to reach a Toto. `relay` may be empty. */
export type Settings = { address: string; token: string; relay: string };
/** A terminal's text, ANSI codes included, and where its cursor is within that text. */
export type TermScreen = { screen: string; cursor: { row: number; col: number } };
/** What an agent is doing, worked out from its history. */
export type Activity = 'idle' | 'working' | 'waiting' | 'failed';

const CONNECT_TIMEOUT = 5_000;
const RETRY_AFTER = 3_000;
const DEVICE_OFFLINE = 4404; // the relay's close code for "that device is not connected"
const STORE_KEY = 'toto.settings';

type Connection = {
  /** 'setup' has no Toto to talk to; 'reconnecting' has one it has reached before and is trying again. */
  status: 'setup' | 'connecting' | 'open' | 'reconnecting';
  /** Why setup did not connect, when there is something to say. */
  notice: string;
  /** How the open connection reaches the device. */
  via: Route;
  settings?: Settings;
  connect: (settings: Settings) => void;
  /** Drops the saved Toto and returns to setup. */
  forget: () => void;
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
  /** What each chat agent is doing, by agent id. */
  activity: Record<string, Activity>;
  /** How many agents are in each state that matters at a glance. */
  tally: { working: number; waiting: number };
  /** The screen of each terminal agent this device has open, by agent id. */
  screens: Record<string, TermScreen>;
};

const Context = createContext<Connection | null>(null);

export const useConnection = () => {
  const value = useContext(Context);
  if (!value) throw new Error('useConnection outside ConnectionProvider');
  return value;
};

export function activityOf(events: AgentEvent[]): Activity {
  let state: Activity = 'idle';
  const open = new Set<string>();
  for (const e of events) {
    if (e.type === 'user') state = 'working';
    else if (e.type === 'done') state = e.isError ? 'failed' : 'idle';
    else if (e.type === 'error') state = 'failed';
    else if (e.type === 'approval_request') open.add(e.id);
    else if (e.type === 'approval_resolved') open.delete(e.id);
  }
  return open.size ? 'waiting' : state;
}

// Only a Toto that has connected is ever saved, so one found here is trusted to exist:
// failing to reach it later means "try again", not "start over".
const load = (): Settings | undefined => {
  try {
    const raw = SecureStore.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);
  const [status, setStatus] = useState<Connection['status']>(settings ? 'reconnecting' : 'setup');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sshKey, setSshKey] = useState<string>();
  const [identity, setIdentity] = useState<Identity>();
  const [events, setEvents] = useState<Connection['events']>({});
  const [screens, setScreens] = useState<Connection['screens']>({});
  const [via, setVia] = useState<Route>('local');
  const socket = useRef<{ send: (message: ClientMessage) => void; close: () => void } | null>(null);
  // Bumped whenever we stop wanting the current connection, so its late callbacks know to do nothing.
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const caughtUp = useRef(false);

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
        // An agent has just stopped to ask. Worth a tap on the wrist, but not for old history.
        if (caughtUp.current && msg.event.type === 'approval_request')
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
      case 'synced':
        caughtUp.current = true;
        // Now that we are talking to our Toto, tell it how to reach this phone when the app is closed.
        pushToken().then((token) => token && post({ type: 'register_push', token }));
        break;
      case 'term':
        setScreens((all) => ({ ...all, [msg.agentId]: { screen: msg.screen, cursor: msg.cursor } }));
        break;
      case 'failed':
        setBusy(false);
        Alert.alert('That did not work', msg.message);
        break;
    }
  };

  /** Opens one encrypted connection. `onFail` fires if it never got as far as hearing from the device. */
  const open = (url: string, psk: Uint8Array, route: Route, mine: number, onLive: () => void, onFail: (deviceOffline: boolean) => void, onLost: () => void) => {
    const ws = new WebSocket(url);
    const nonce = bytesToHex(getRandomValues(new Uint8Array(NONCE_BYTES)));
    let secure: Session | undefined;
    let live = false;
    const giveUp = setTimeout(() => ws.close(), CONNECT_TIMEOUT);
    const sealed = (message: ClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'data', b: secure!.seal(JSON.stringify(message)) } satisfies Frame));
    };

    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', n: nonce } satisfies Frame));
    ws.onmessage = (m) => {
      if (generation.current !== mine) return ws.close();
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
          socket.current = { send: sealed, close: () => ws.close() };
          caughtUp.current = false;
          setEvents({}); // the device is about to replay every history
          setScreens({});
          setVia(route);
          onLive();
        }
        receive(msg);
      } catch {
        ws.close();
      }
    };
    ws.onclose = (e) => {
      clearTimeout(giveUp);
      if (generation.current !== mine) return;
      if (!live) return onFail(e.code === DEVICE_OFFLINE);
      socket.current = null;
      setBusy(false);
      onLost();
    };
  };

  /** Tries the local network, then the relay. A first attempt reports failure; later ones keep trying. */
  const dial = (to: Settings, firstTime: boolean) => {
    const mine = ++generation.current;
    clearTimeout(retry.current);
    const { psk, deviceId, relayKey } = keysFromToken(to.token.trim());
    const again = () => {
      setStatus('reconnecting');
      retry.current = setTimeout(() => dial(to, false), RETRY_AFTER);
    };
    const live = () => {
      if (firstTime) {
        SecureStore.setItem(STORE_KEY, JSON.stringify(to));
        setSettings(to);
      }
      setStatus('open');
    };
    const failed = (message: string) => {
      if (!firstTime) return again();
      setNotice(message);
      setStatus('setup');
    };
    // The local network first, since it is faster and works with no internet; then the relay.
    const viaRelay = () => {
      const relay = to.relay.trim().replace(/\/$/, '');
      if (!relay) return failed('Nothing answered at that address with that token.');
      open(`${relay}/v1/${deviceId}?role=client&k=${relayKey}`, psk, 'relay', mine, live, (deviceOffline) =>
        failed(deviceOffline ? 'That Toto is not connected to the relay. Is it switched on?' : 'Nothing answered with that token, locally or through the relay.'),
      again);
    };
    open(to.address.trim(), psk, 'local', mine, live, viaRelay, again);
  };

  // A Toto we already know: connect without being asked.
  useEffect(() => {
    if (settings) return dial(settings, false);
    // Development: `expo start` with an address and token in the environment connects straight away.
    const address = process.env.EXPO_PUBLIC_TOTO_URL;
    const token = process.env.EXPO_PUBLIC_TOTO_TOKEN;
    if (__DEV__ && address && token) dial({ address, token, relay: process.env.EXPO_PUBLIC_TOTO_RELAY ?? '' }, true);
    // Once, at launch, with the settings loaded then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = (to: Settings) => {
    setNotice('');
    setStatus('connecting');
    dial(to, true);
  };

  const forget = () => {
    generation.current++;
    clearTimeout(retry.current);
    socket.current?.close();
    socket.current = null;
    SecureStore.deleteItemAsync(STORE_KEY).catch(() => {});
    setSettings(undefined);
    setProjects([]);
    setAgents([]);
    setEvents({});
    setStatus('setup');
  };

  const post = (message: ClientMessage) => socket.current?.send(message);
  const request = (message: ClientMessage) => {
    if (!socket.current) return;
    setBusy(true);
    post(message);
  };

  const activity = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, activityOf(events[a.id] ?? [])])), [agents, events]);
  const tally = useMemo(() => {
    const states = Object.values(activity);
    return { working: states.filter((s) => s === 'working').length, waiting: states.filter((s) => s === 'waiting').length };
  }, [activity]);

  return (
    <Context.Provider value={{ status, notice, via, settings, connect, forget, post, request, busy, projects, agents, identity, sshKey, events, activity, tally, screens }}>
      {children}
    </Context.Provider>
  );
}
