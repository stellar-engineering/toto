import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { Agent, AgentEvent, ClientMessage, Project, ServerMessage } from '../../protocol';

export type { Agent, AgentEvent, ClientMessage, Mode, Project } from '../../protocol';

type Connection = {
  status: 'idle' | 'connecting' | 'open';
  /** Why we are not connected, when there is something to say. */
  notice: string;
  connect: (url: string, token: string) => void;
  post: (message: ClientMessage) => void;
  /** Like `post`, for requests that take a while. `busy` stays true until the server answers. */
  request: (message: ClientMessage) => void;
  busy: boolean;
  projects: Project[];
  agents: Agent[];
  /** The device's public SSH key, when it has one. */
  sshKey?: string;
  /** Each agent's history, by agent id. */
  events: Record<string, AgentEvent[]>;
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
  const [events, setEvents] = useState<Connection['events']>({});
  const socket = useRef<WebSocket | null>(null);

  const connect = (url: string, token: string) => {
    setStatus('connecting');
    setNotice('');
    setEvents({}); // the server replays every history on connect
    const ws = new WebSocket(`${url.trim()}/?token=${encodeURIComponent(token.trim())}`);
    socket.current = ws;
    ws.onopen = () => setStatus('open');
    ws.onmessage = (m) => {
      const msg: ServerMessage = JSON.parse(m.data);
      switch (msg.type) {
        case 'state':
          setProjects(msg.projects);
          setAgents(msg.agents);
          setSshKey(msg.sshKey);
          setBusy(false);
          break;
        case 'event':
          // ponytail: copies the agent's history per event, which is slow when replaying a long one.
          // Batch the replay when that shows.
          setEvents((all) => ({ ...all, [msg.agentId]: [...(all[msg.agentId] ?? []), msg.event] }));
          break;
        case 'failed':
          setBusy(false);
          Alert.alert('That did not work', msg.message);
          break;
      }
    };
    ws.onclose = () => {
      setBusy(false);
      setStatus((was) => {
        setNotice(was === 'open' ? 'Connection lost.' : 'Could not connect. Check the address and token.');
        return 'idle';
      });
    };
  };

  const post = (message: ClientMessage) => socket.current?.send(JSON.stringify(message));
  const request = (message: ClientMessage) => {
    setBusy(true);
    post(message);
  };

  return (
    <Context.Provider value={{ status, notice, connect, post, request, busy, projects, agents, sshKey, events }}>
      {children}
    </Context.Provider>
  );
}
