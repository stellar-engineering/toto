import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { useConnection, type Activity, type Agent } from '../../connection';
import { Face } from '../../face';
import { moodOf } from '../../moods';
import { Btn, Check, Empty, Field, Header, Reaching, Screen, StatusLine, Txt, Waiting, styles } from '../../ui';

const STATE: Record<Activity, { glyph: string; tone: 'ghost' | 'signal' | 'amber' | 'raspberry'; label: string }> = {
  idle: { glyph: '○', tone: 'ghost', label: 'idle' },
  working: { glyph: '●', tone: 'signal', label: 'working' },
  waiting: { glyph: '◆', tone: 'amber', label: 'waiting on you' },
  failed: { glyph: '✕', tone: 'raspberry', label: 'stopped on an error' },
};

function AgentRow({ agent }: { agent: Agent }) {
  const { activity } = useConnection();
  const router = useRouter();
  const state = STATE[activity[agent.id] ?? 'idle'];
  const terminal = agent.harness === 'terminal';
  return (
    <Pressable onPress={() => router.push({ pathname: '/agent/[id]', params: { id: agent.id } })} style={({ pressed }) => [styles.row, { flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`${agent.name}, ${terminal ? 'terminal' : state.label}`}>
        {/* A fixed-width column, so names line up like a process list. A terminal is you, not Toto, so it gets a prompt. */}
        <View style={styles.faceCol}>{terminal ? <Txt tone="ghost" weight="bold">  $</Txt> : <Face mood={moodOf(activity[agent.id] ?? 'idle')} size={13} />}</View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" numberOfLines={1}>{agent.name}</Txt>
          <Txt tone="ghost" small>{agent.worktree ? 'own branch' : 'main checkout'}</Txt>
        </View>
        <Txt tone={terminal ? 'ghost' : state.tone} weight={state.label === 'waiting on you' && !terminal ? 'bold' : 'regular'}>{terminal ? 'terminal' : state.label}</Txt>
    </Pressable>
  );
}

function StartAgent({ projectId }: { projectId: string }) {
  const { request, busy, status } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [auto, setAuto] = useState(false);
  const [terminal, setTerminal] = useState(false);
  // Nothing can be asked of a Toto that is not there, and asking would silently do nothing.
  if (status !== 'open')
    return (
      <View style={styles.row} accessibilityState={{ disabled: true }}>
        <Txt tone="ghost">+ Start an agent</Txt>
        <Txt tone="ghost" small>Once your Toto is reached again.</Txt>
      </View>
    );
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.row} accessibilityRole="button">
        <Txt tone="amber">+ Start an agent</Txt>
      </Pressable>
    );
  const start = () => {
    request({ type: 'create_agent', projectId, name, harness: terminal ? 'terminal' : 'claude', worktree, mode: auto ? 'auto' : 'ask' });
    setName('');
    setOpen(false);
  };
  return (
    <View style={styles.form}>
      <Field label="name" value={name} onChangeText={setName} placeholder="what to call it" autoFocus />
      <Check label="Own branch, so it cannot clash with other agents" value={worktree} onChange={setWorktree} />
      {/* ponytail: a checkbox while there are two kinds of agent; a picker when Codex and Gemini arrive. */}
      <Check label="Plain terminal, to run any tool by hand" value={terminal} onChange={setTerminal} />
      {!terminal && <Check label="Full auto: act without asking first" value={auto} onChange={setAuto} />}
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 12 }}>
        <Btn kind="primary" label="Start it" onPress={start} disabled={busy || !name.trim()} style={{ flex: 1 }} />
        <Btn label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { projects, agents, post, node, loaded, pending } = useConnection();
  const router = useRouter();
  const project = projects.find((p) => p.id === id);

  const remove = () =>
    Alert.alert(`Delete ${project?.name ?? 'this project'}?`, 'This removes its files from your Toto, along with every agent in it and any work they have not pushed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete project',
        style: 'destructive',
        onPress: () => {
          post({ type: 'delete_project', projectId: id });
          router.back();
        },
      },
    ]);

  const starting = pending?.type === 'create_agent' && pending.projectId === id ? pending : undefined;

  return (
    <Screen>
      <Header parent={node?.name ?? 'toto'} title={project?.name ?? (loaded ? 'gone' : '…')} />
      <View style={{ flex: 1 }}>
        {!loaded ? <Reaching what="this project" /> : !project ? <Empty mood="offline">This project is no longer on this Toto. It may have been deleted from another phone.</Empty> : (
        <FlatList
          data={agents.filter((a) => a.projectId === id)}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <AgentRow agent={item} />}
          ListEmptyComponent={starting ? null : <Empty mood="resting">Nobody is working here yet. Start an agent and give it something to do.</Empty>}
          ListFooterComponent={
            <>
              {starting ? (
                // Where the agent will be, while its branch and session are made.
                <View style={[styles.row, { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }]}>
                  <View style={styles.faceCol}><Face mood="working" size={13} /></View>
                  <View style={{ flex: 1 }}>
                    <Txt weight="bold" numberOfLines={1}>{starting.name}</Txt>
                    <Waiting hint={starting.worktree ? 'Making its own copy of a large repository takes a little while.' : undefined}>Starting…</Waiting>
                  </View>
                </View>
              ) : (
                <StartAgent projectId={id} />
              )}
              {project?.lan !== undefined && (
                <View style={[styles.row, { paddingVertical: 8 }]}>
                  <Check label="Let agents reach devices on your home network" value={project.lan} onChange={(allow) => post({ type: 'set_lan', projectId: id, allow })} />
                  <Txt tone="ghost" small>{project.lan ? 'Agents here can talk to your router, other computers and anything else on your network.' : 'Agents here can reach the internet, but nothing else on your network.'}</Txt>
                </View>
              )}
              {/* Out of the way at the end of the list: rarely wanted, and never by accident. */}
              <Pressable onPress={remove} style={styles.row} accessibilityRole="button">
                <Txt tone="raspberry">Delete this project</Txt>
              </Pressable>
            </>
          }
        />
        )}
      </View>
      <StatusLine />
    </Screen>
  );
}
