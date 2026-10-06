import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { useConnection, type Activity, type Agent } from '../../connection';
import { Btn, Check, Field, Header, Screen, Spinner, StatusLine, Txt, styles } from '../../ui';

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
        {/* A fixed-width column, so names line up like a process list. */}
        <View style={{ width: 14 }}>{!terminal && state.label === 'working' ? <Spinner /> : <Txt tone={terminal ? 'ghost' : state.tone}>{terminal ? '$' : state.glyph}</Txt>}</View>
        <View style={{ flex: 1 }}>
          <Txt weight="bold" numberOfLines={1}>{agent.name}</Txt>
          <Txt tone="ghost" small>{agent.worktree ? 'own branch' : 'main checkout'}</Txt>
        </View>
        <Txt tone={terminal ? 'ghost' : state.tone} weight={state.label === 'waiting on you' && !terminal ? 'bold' : 'regular'}>{terminal ? 'terminal' : state.label}</Txt>
    </Pressable>
  );
}

function StartAgent({ projectId }: { projectId: string }) {
  const { request, busy } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [auto, setAuto] = useState(false);
  const [terminal, setTerminal] = useState(false);
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
  const { projects, agents, post } = useConnection();
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

  return (
    <Screen>
      <Header parent="toto" title={project?.name ?? 'gone'} />
      <View style={{ flex: 1 }}>
        <FlatList
          data={agents.filter((a) => a.projectId === id)}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <AgentRow agent={item} />}
          ListEmptyComponent={
            <View style={styles.row}>
              <Txt tone="ghost">Nobody is working here yet.</Txt>
            </View>
          }
          ListFooterComponent={
            <>
              <StartAgent projectId={id} />
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
      </View>
      <StatusLine />
    </Screen>
  );
}
