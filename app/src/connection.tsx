import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { Agent, AgentEvent, ClaudeAccount, ClientMessage, Identity, Project, ServerMessage } from '../../protocol';
import { type Link, type Unreachable, type Route, type Settings, deviceIdOf, ping, reach } from './link';
import { pushToken } from './push';

export type { Agent, AgentEvent, ClaudeAccount, ClientMessage, Harness, Identity, Mode, Project, TermKey } from '../../protocol';
export type { Settings } from './link';

/** A Toto this phone knows: where it is, the secret shared with it, and what it is called. */
export type Node = Settings & { id: string; name: string };
/** A terminal's text, ANSI codes included, and where its cursor is within that text. */
export type TermScreen = { screen: string; cursor: { row: number; col: number } };
/** What an agent is doing, worked out from its history. */
export type Activity = 'idle' | 'working' | 'waiting' | 'failed';

const RETRY_AFTER = 3_000;
const STORE_KEY = 'toto.nodes';
const OLD_STORE_KEY = 'toto.settings'; // from when the app knew a single Toto
/** The hosted relay, used unless someone chooses otherwise. */
export const DEFAULT_RELAY = process.env.EXPO_PUBLIC_TOTO_RELAY ?? 'wss://toto.royletron.dev';

type Connection = {
  /** 'setup' knows no Toto at all; 'reconnecting' is trying to reach the current one. */
  status: 'setup' | 'open' | 'reconnecting';
  /** Every Toto this phone knows. */
  nodes: Node[];
  /** The one the rest of the app is showing. */
  node?: Node;
  /** How the open connection reaches it. */
  via: Route;
  /**
   * Checks a Toto answers, then remembers it and switches to it. `name`, if given, becomes the
   * device's name. Resolves to what went wrong, or to nothing if it worked.
   */
  addNode: (to: Settings & { name?: string }) => Promise<string | undefined>;
  switchTo: (id: string) => void;
  /** Records a name learned from a Toto that is not the current one. */
  learnName: (id: string, name: string) => void;
  /** Changes where the current Toto is looked for, and reconnects. An empty relay means local network only. */
  relocate: (where: Pick<Settings, 'address' | 'relay'>) => void;
  /** Stops knowing the current Toto, and moves to another if there is one. */
  forget: () => void;
  post: (message: ClientMessage) => void;
  /** Like `post`, for requests that take a while. `pending` is that request until the server answers. */
  request: (message: ClientMessage) => void;
  pending?: ClientMessage;
  busy: boolean;
  /** While not open: what is being tried to reach the Toto, why the last try failed, and how many have. */
  trying: Trying;
  /** The Toto has said what it holds since we started showing it. Until then, empty lists mean "not known yet". */
  loaded: boolean;
  /** Every conversation has been replayed since we started showing it. */
  synced: boolean;
  projects: Project[];
  agents: Agent[];
  /** How this Toto's agents are signed in to Claude. Undefined until it has said. */
  claude?: ClaudeAccount;
  /** What this Toto runs, the newer release there is if any, and whether it is installing one. Undefined on a Toto too old to say. */
  software?: { version: string; latest?: string; updating: boolean };
  /** The page to open for a Claude sign-in that is under way. */
  claudeLogin?: string;
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

export type Trying = { phase: Route | 'waiting'; why?: Unreachable | 'lost'; tries: number };

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

type Saved = { active?: string; nodes: Node[] };

// Only a Toto that has answered is ever saved, so one found here is trusted to exist: failing
// to reach it later means "try again", not "start over".
// ponytail: one keychain entry for the lot, which on some iOS versions tops out near 2KB, or
// roughly eight Totos. Split it into an entry each if anyone gets there.
const store = (saved: Saved) => SecureStore.setItem(STORE_KEY, JSON.stringify(saved));

const load = (): Saved => {
  try {
    const raw = SecureStore.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
    // Carry over the single Toto an earlier version saved.
    const old = SecureStore.getItem(OLD_STORE_KEY);
    if (!old) return { nodes: [] };
    const { v, ...settings } = JSON.parse(old) as Settings & { v?: number };
    // The earliest versions could save no relay without anyone having chosen that.
    if (!v && !settings.relay) settings.relay = DEFAULT_RELAY;
    const id = deviceIdOf(settings.token);
    const name = settings.address.replace(/^wss?:\/\//, '').replace(/:\d+$/, '');
    return { active: id, nodes: [{ ...settings, id, name }] };
  } catch {
    return { nodes: [] };
  }
};

// Development: `expo start` with an address and token in the environment connects straight away.
const devSettings: Settings | undefined =
  __DEV__ && process.env.EXPO_PUBLIC_TOTO_URL && process.env.EXPO_PUBLIC_TOTO_TOKEN
    ? { address: process.env.EXPO_PUBLIC_TOTO_URL, token: process.env.EXPO_PUBLIC_TOTO_TOKEN, relay: DEFAULT_RELAY }
    : undefined;

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState(load);
  const node = saved.nodes.find((n) => n.id === saved.active) ?? saved.nodes[0];
  const [status, setStatus] = useState<Connection['status']>(node ? 'reconnecting' : 'setup');
  const [pending, setPending] = useState<ClientMessage>();
  const [trying, setTrying] = useState<Trying>({ phase: 'local', tries: 0 });
  const [loaded, setLoaded] = useState(false);
  const [synced, setSynced] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sshKey, setSshKey] = useState<string>();
  const [identity, setIdentity] = useState<Identity>();
  const [claude, setClaude] = useState<ClaudeAccount>();
  const [claudeLogin, setClaudeLogin] = useState<string>();
  const [software, setSoftware] = useState<{ version: string; latest?: string; updating: boolean }>();
  const [events, setEvents] = useState<Connection['events']>({});
  const [screens, setScreens] = useState<Connection['screens']>({});
  const [via, setVia] = useState<Route>('local');

  const link = useRef<Link | null>(null);
  // Abandons whatever connection is being made or held, so its late callbacks do nothing.
  const abandon = useRef<() => void>(() => {});
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const caughtUp = useRef(false);
  // Histories being replayed. They are shown all at once when the replay ends, so a reconnect
  // swaps the old conversation for the new one instead of emptying the screen and refilling it.
  const replay = useRef<Connection['events']>({});
  const tries = useRef(0);
  // A name chosen while adding a Toto, to give the device once we are talking to it.
  const naming = useRef<{ id: string; name: string } | undefined>(undefined);

  const remember = (change: (was: Saved) => Saved) =>
    setSaved((was) => {
      const next = change(was);
      store(next);
      return next;
    });

  const learnName = (id: string, name: string) =>
    remember((was) => (was.nodes.some((n) => n.id === id && n.name !== name) ? { ...was, nodes: was.nodes.map((n) => (n.id === id ? { ...n, name } : n)) } : was));

  const post = (message: ClientMessage) => link.current?.send(message);

  const receive = (to: Node, msg: ServerMessage) => {
    switch (msg.type) {
      case 'state':
        setProjects(msg.projects);
        setAgents(msg.agents);
        setSshKey(msg.sshKey);
        setIdentity(msg.identity);
        setSoftware(msg.version ? { version: msg.version, latest: msg.latest, updating: msg.updating } : undefined);
        setClaude((was) => {
          // However it changed, a sign-in that was under way is over.
          if (was !== msg.claude) setClaudeLogin(undefined);
          return msg.claude;
        });
        setPending(undefined);
        setLoaded(true);
        if (naming.current?.id !== to.id) learnName(to.id, msg.name);
        break;
      case 'event':
        if (!caughtUp.current) {
          (replay.current[msg.agentId] ??= []).push(msg.event);
          break;
        }
        setEvents((all) => ({ ...all, [msg.agentId]: [...(all[msg.agentId] ?? []), msg.event] }));
        // An agent has just stopped to ask. Worth a tap on the wrist, but not for old history.
        if (caughtUp.current && msg.event.type === 'approval_request')
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
      case 'synced':
        caughtUp.current = true;
        setEvents(replay.current);
        replay.current = {};
        setSynced(true);
        if (naming.current?.id === to.id) {
          post({ type: 'rename_device', name: naming.current.name });
          naming.current = undefined;
        }
        // Now that we are talking to this Toto, tell it how to reach this phone when the app is closed.
        pushToken().then((token) => token && post({ type: 'register_push', token }));
        break;
      case 'claude_login':
        setPending(undefined);
        setClaudeLogin(msg.url);
        break;
      case 'term':
        setScreens((all) => ({ ...all, [msg.agentId]: { screen: msg.screen, cursor: msg.cursor } }));
        break;
      case 'failed':
        setPending(undefined);
        Alert.alert('That did not work', msg.message);
        break;
    }
  };

  /** Connects to `to` and keeps trying for as long as it stays the one we want. */
  const dial = (to: Node) => {
    abandon.current();
    clearTimeout(retry.current);
    let wanted = true;
    const again = (why: Trying['why']) => {
      if (!wanted) return;
      link.current = null;
      setPending(undefined);
      setTrying({ phase: 'waiting', why, tries: ++tries.current });
      setStatus('reconnecting');
      retry.current = setTimeout(() => wanted && dial(to), RETRY_AFTER);
    };
    const cancel = reach(
      to,
      {
        first: { type: 'sync' },
        onMessage: (msg) => wanted && receive(to, msg),
        onLost: () => again('lost'),
        onTry: (via) => wanted && setTrying((was) => ({ ...was, phase: via })),
      },
      (result) => {
        if (!wanted) return typeof result === 'string' ? undefined : result.close();
        if (typeof result === 'string') return again(result);
        link.current = result;
        tries.current = 0;
        // The device is about to replay every history. What is on screen stays until it has.
        caughtUp.current = false;
        replay.current = {};
        setScreens({});
        setVia(result.via);
        setStatus('open');
      },
    );
    abandon.current = () => {
      wanted = false;
      cancel();
    };
  };

  /** Makes `to` the Toto the app is showing. */
  const show = (to: Node | undefined) => {
    abandon.current();
    abandon.current = () => {};
    clearTimeout(retry.current);
    link.current = null;
    setPending(undefined);
    tries.current = 0;
    setTrying({ phase: 'local', tries: 0 });
    setLoaded(false);
    setSynced(false);
    setProjects([]);
    setAgents([]);
    setEvents({});
    setScreens({});
    setSshKey(undefined);
    setIdentity(undefined);
    setClaude(undefined);
    setClaudeLogin(undefined);
    setSoftware(undefined);
    if (!to) return setStatus('setup');
    setStatus('reconnecting');
    dial(to);
  };

  const addNode: Connection['addNode'] = async ({ name, ...settings }) => {
    const to = { address: settings.address.trim(), token: settings.token.trim(), relay: settings.relay.trim() };
    const found = await ping(to);
    if (found === 'offline') return 'That Toto is not connected to the relay. Is it switched on?';
    if (found === 'silent') return 'Nothing answered with that token, on this network or through the relay.';
    const id = deviceIdOf(to.token);
    const chosen = name?.trim();
    if (chosen && chosen !== found.name) naming.current = { id, name: chosen };
    const added: Node = { ...to, id, name: chosen || found.name };
    remember((was) => ({ active: id, nodes: [...was.nodes.filter((n) => n.id !== id), added] }));
    show(added);
    return undefined;
  };

  const switchTo = (id: string) => {
    const to = saved.nodes.find((n) => n.id === id);
    if (!to || to.id === node?.id) return;
    remember((was) => ({ ...was, active: id }));
    show(to);
  };

  const relocate: Connection['relocate'] = (where) => {
    if (!node) return;
    const moved = { ...node, address: where.address.trim(), relay: where.relay.trim() };
    remember((was) => ({ ...was, nodes: was.nodes.map((n) => (n.id === moved.id ? moved : n)) }));
    setStatus('reconnecting');
    dial(moved);
  };

  const forget = () => {
    if (!node) return;
    const rest = saved.nodes.filter((n) => n.id !== node.id);
    remember(() => ({ active: rest[0]?.id, nodes: rest }));
    show(rest[0]);
  };

  // At launch: the Toto we were last showing, without being asked.
  useEffect(() => {
    if (node) return dial(node);
    if (!devSettings) return;
    const soon = setTimeout(() => addNode(devSettings), 0);
    return () => clearTimeout(soon);
    // Once, with whatever was saved then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request = (message: ClientMessage) => {
    if (!link.current) return;
    setPending(message);
    post(message);
  };

  const activity = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, activityOf(events[a.id] ?? [])])), [agents, events]);
  const tally = useMemo(() => {
    const states = Object.values(activity);
    return { working: states.filter((s) => s === 'working').length, waiting: states.filter((s) => s === 'waiting').length };
  }, [activity]);

  return (
    <Context.Provider value={{ status, nodes: saved.nodes, node, via, addNode, switchTo, learnName, relocate, forget, post, request, pending, busy: !!pending, trying, loaded, synced, projects, agents, claude, claudeLogin, software, identity, sshKey, events, activity, tally, screens }}>
      {children}
    </Context.Provider>
  );
}
