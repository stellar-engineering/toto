import * as Haptics from 'expo-haptics';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { Agent, AgentEvent, ClaudeAccount, ClientMessage, FileRef, Identity, ImageRef, Phone, Plugin, Project, ServerMessage } from '../../protocol';
import { bytesToHex } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import { DEMO, DEMO_NODE } from './demo';
import type { Invitation, Invite } from './invite';
import { read, write } from './storage';
import { type Link, type Unreachable, type Route, type Settings, deviceIdOf, ping, reach } from './link';
import { pushToken } from './push';

export type { ImageRef, Phone, Agent, AgentEvent, ClaudeAccount, ClientMessage, FileRef, Harness, Identity, Mode, Plugin, Project, TermKey } from '../../protocol';
export type { Settings } from './link';
export type { Invitation, Invite } from './invite';

/** A Toto this phone knows: where it is, the secret shared with it, and what it is called. */
export type Node = Settings & { id: string; name: string };
/** A terminal's text, ANSI codes included, and where its cursor is within that text. */
export type TermScreen = { screen: string; cursor: { row: number; col: number } };
/** What an agent is doing, worked out from its history. */
export type Activity = 'idle' | 'working' | 'waiting' | 'failed';

const RETRY_AFTER = 3_000;
// A picture is sent to an agent in pieces of this many base64 characters.
const PIECE = 64_000;
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
  /** What can be added to this Toto, and what has been. Undefined on a Toto too old to have plugins. */
  plugins?: Plugin[];
  /** The code to enter, and where, for a plugin sign-in that is under way. */
  pluginLogin?: { name: string; url: string; code: string };
  /** The phones this Toto is shared with. Undefined on a Toto too old to be shared. */
  phones?: Phone[];
  /** This phone is the one that set the Toto up, and so the one that may share it and take that back. */
  owner: boolean;
  /** The invitation just made for another phone, until `doneSharing` puts it away. */
  invite?: Invite;
  doneSharing: () => void;
  /** Adds the demo: a pretend Toto inside the app, for looking around without owning one. */
  addDemo: () => void;
  /** Uses an invitation from another phone to get this one a key of its own. Resolves to what went wrong, or to nothing. */
  join: (invitation: Invitation) => Promise<string | undefined>;
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
  /** Pictures fetched from the Toto so far, as base64, by picture id. */
  pictures: Record<string, string>;
  /** Fetches a picture from an agent's conversation, unless it is here or already on its way. */
  wantPicture: (agentId: string, image: ImageRef) => void;
  /** Fetches a file an agent sent. It arrives in `pictures`, by its id; `dropPicture` lets go of it. */
  wantFile: (agentId: string, file: FileRef) => void;
  dropPicture: (id: string) => void;
  /** Says something to an agent, with any pictures to go with it. */
  say: (agentId: string, text: string, pictures?: { mime: string; base64: string }[]) => void;
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
const store = (saved: Saved) => write(STORE_KEY, JSON.stringify(saved));

const load = (): Saved => {
  try {
    const raw = read(STORE_KEY);
    if (raw) return JSON.parse(raw);
    // Carry over the single Toto an earlier version saved.
    const old = read(OLD_STORE_KEY);
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
  const [plugins, setPlugins] = useState<Plugin[]>();
  const [pluginLogin, setPluginLogin] = useState<Connection['pluginLogin']>();
  const [phones, setPhones] = useState<Phone[]>();
  const [owner, setOwner] = useState(true);
  const [invite, setInvite] = useState<Invite>();
  const [software, setSoftware] = useState<{ version: string; latest?: string; updating: boolean }>();
  const [events, setEvents] = useState<Connection['events']>({});
  const [screens, setScreens] = useState<Connection['screens']>({});
  const [pictures, setPictures] = useState<Connection['pictures']>({});
  // Pictures on their way: the pieces that have arrived so far, by picture id.
  const arriving = useRef<Record<string, string[]>>({});
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
        setPlugins(msg.plugins);
        // A sign-in that finished, or whose plugin has gone, is over.
        setPluginLogin((was) => {
          const now = was && msg.plugins?.find((p) => p.name === was.name);
          return !now || now.signedIn ? undefined : was;
        });
        setPhones(msg.phones);
        setOwner(msg.owner ?? true);
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
        // (Not the demo: it has nothing to tell anyone, and asking to send notifications for it would be odd.)
        if (to.address !== DEMO) pushToken().then((token) => token && post({ type: 'register_push', token }));
        break;
      case 'invite':
        setPending(undefined);
        setInvite(msg);
        break;
      case 'claude_login':
        setPending(undefined);
        setClaudeLogin(msg.url);
        break;
      case 'plugin_login':
        setPending(undefined);
        setPluginLogin({ name: msg.name, url: msg.url, code: msg.code });
        break;
      case 'image':
      case 'file': {
        const pieces = arriving.current[msg.id];
        if (!pieces) break;
        pieces[msg.at] = msg.data;
        if (pieces.filter(Boolean).length < msg.of) break;
        delete arriving.current[msg.id];
        // ponytail: the most recent few dozen are kept in memory and the rest fetched again if
        // scrolled back to. Keep them on disk if that proves slow.
        setPictures((all) => {
          const kept = Object.entries(all).slice(-39);
          return { ...Object.fromEntries(kept), [msg.id]: pieces.join('') };
        });
        break;
      }
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
      // Turned away is final until someone shares it again: asking every few seconds changes nothing.
      if (why !== 'refused') retry.current = setTimeout(() => wanted && dial(to), RETRY_AFTER);
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
        arriving.current = {}; // whatever was on its way went with the old line
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
    setPictures({});
    arriving.current = {};
    setSshKey(undefined);
    setIdentity(undefined);
    setClaude(undefined);
    setClaudeLogin(undefined);
    setPlugins(undefined);
    setPluginLogin(undefined);
    setSoftware(undefined);
    setPhones(undefined);
    setOwner(true);
    setInvite(undefined);
    if (!to) return setStatus('setup');
    setStatus('reconnecting');
    dial(to);
  };

  const addNode: Connection['addNode'] = async ({ name, ...settings }) => {
    const to = { address: settings.address.trim(), token: settings.token.trim(), relay: settings.relay.trim() };
    const found = await ping(to);
    if (found === 'offline') return 'That Toto is not connected to the relay. Is it switched on?';
    if (typeof found === 'string') return 'Nothing answered with that token, on this network or through the relay.';
    const id = deviceIdOf(to.token);
    const chosen = name?.trim();
    if (chosen && chosen !== found.name) naming.current = { id, name: chosen };
    const added: Node = { ...to, id, name: chosen || found.name };
    remember((was) => ({ active: id, nodes: [...was.nodes.filter((n) => n.id !== id), added] }));
    show(added);
    return undefined;
  };

  const addDemo = () => {
    remember((was) => ({ active: DEMO_NODE.id, nodes: [...was.nodes.filter((n) => n.id !== DEMO_NODE.id), DEMO_NODE] }));
    show(DEMO_NODE);
  };

  const join: Connection['join'] = async (inv) => {
    if (saved.nodes.some((n) => n.id === inv.deviceId)) return `This phone already has ${inv.name}.`;
    const guest = { deviceId: inv.deviceId, relayKey: inv.relayKey, phone: inv.phoneId };
    const where = { address: inv.address.trim(), relay: inv.relay.trim(), guest };
    // The invitation opens one conversation, in which the device hands over a key made for this phone.
    const secret = await new Promise<string | Unreachable>((resolve) => {
      setTimeout(() => resolve('silent'), 25_000);
      reach(
        { ...where, token: inv.secret },
        {
          first: { type: 'join' },
          onMessage: (message, line) => {
            if (message.type !== 'joined') return;
            resolve(message.secret);
            line.close();
          },
          // Hung up on without a key: the invitation had already been used.
          onLost: () => resolve('refused'),
        },
        (result) => typeof result === 'string' && resolve(result),
      );
    });
    if (secret === 'refused') return 'That invitation has been used or has run out. Ask for a new one.';
    if (secret === 'offline') return `${inv.name} is not connected to the relay, and is not on this network. Is it switched on?`;
    if (secret === 'silent') return `${inv.name} did not answer. Join the same Wi-Fi as it, or check it is switched on, and scan again.`;
    const added: Node = { ...where, token: secret, id: inv.deviceId, name: inv.name };
    remember((was) => ({ active: added.id, nodes: [...was.nodes.filter((n) => n.id !== added.id), added] }));
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

  const wantPicture: Connection['wantPicture'] = (agentId, image) => {
    if (!link.current || pictures[image.id] !== undefined || arriving.current[image.id]) return;
    arriving.current[image.id] = [];
    post({ type: 'image', agentId, id: image.id });
  };

  const wantFile: Connection['wantFile'] = (agentId, file) => {
    if (!link.current || pictures[file.id] !== undefined || arriving.current[file.id]) return;
    arriving.current[file.id] = [];
    post({ type: 'file', agentId, id: file.id });
  };
  const dropPicture = (id: string) =>
    setPictures((all) => {
      const { [id]: _gone, ...rest } = all;
      return rest;
    });

  const say: Connection['say'] = (agentId, text, sending = []) => {
    const images = sending.map((picture) => {
      const id = bytesToHex(getRandomValues(new Uint8Array(8)));
      // In pieces small enough for the relay, which will not pass a large message.
      const of = Math.ceil(picture.base64.length / PIECE);
      for (let at = 0; at < of; at++) post({ type: 'upload', id, at, of, data: picture.base64.slice(at * PIECE, (at + 1) * PIECE) });
      return { id, mime: picture.mime };
    });
    post({ type: 'prompt', agentId, text, ...(images.length ? { images } : null) });
  };

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
    <Context.Provider value={{ status, nodes: saved.nodes, node, via, addNode, switchTo, learnName, relocate, forget, post, request, pending, busy: !!pending, trying, loaded, synced, projects, agents, claude, claudeLogin, plugins, pluginLogin, phones, owner, invite, doneSharing: () => setInvite(undefined), join, addDemo, software, identity, sshKey, events, activity, tally, screens, pictures, wantPicture, wantFile, dropPicture, say }}>
      {children}
    </Context.Provider>
  );
}
