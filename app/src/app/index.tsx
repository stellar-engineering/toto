import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useConnection, type Project } from '../connection';
import { Face } from '../face';
import { moodOfMany } from '../moods';
import { Btn, Empty, Field, Header, Screen, StatusLine, Txt, styles } from '../ui';

function ProjectRow({ project }: { project: Project }) {
  const { agents, activity } = useConnection();
  const router = useRouter();
  const mine = agents.filter((a) => a.projectId === project.id);
  const count = (state: string) => mine.filter((a) => activity[a.id] === state).length;
  const waiting = count('waiting');
  const working = count('working');
  return (
    <Pressable onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })} style={({ pressed }) => [styles.row, { flexDirection: 'row', alignItems: 'center' }, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      {/* One face for the project: whichever of its agents most needs attention sets it. */}
      <View style={styles.faceCol}><Face mood={moodOfMany(mine.filter((a) => a.harness === 'claude').map((a) => activity[a.id] ?? 'idle'))} size={13} /></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Txt weight="bold" numberOfLines={1} style={{ flex: 1 }}>{project.name}</Txt>
          {waiting > 0 ? (
            <Txt tone="amber" weight="bold">{waiting} waiting on you</Txt>
          ) : working > 0 ? (
            <Txt tone="signal">{working} working</Txt>
          ) : (
            <Txt tone="ghost">{mine.length === 0 ? 'no agents' : mine.length === 1 ? '1 agent' : `${mine.length} agents`}</Txt>
          )}
        </View>
        <Txt tone="ghost" small numberOfLines={1}>{project.repo.replace(/^(https:\/\/|git@)/, '').replace(/\.git$/, '')}</Txt>
      </View>
    </Pressable>
  );
}

function AddProject() {
  const { request, busy, sshKey } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  if (!open)
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.row} accessibilityRole="button">
        <Txt tone="amber">+ Add a project</Txt>
      </Pressable>
    );
  const add = () => {
    request({ type: 'create_project', name, repo });
    setName('');
    setRepo('');
    setOpen(false);
  };
  return (
    <View style={styles.form}>
      <Field label="name" value={name} onChangeText={setName} placeholder="what to call it" autoFocus autoCapitalize="sentences" />
      <Field label="repo" value={repo} onChangeText={setRepo} placeholder="git@github.com:you/repo.git" />
      {!!sshKey && <Txt tone="ghost" small style={{ paddingTop: 8 }}>For a private repo, add this Toto&apos;s SSH key to your git host first. It is under device settings, on the bottom line.</Txt>}
      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 12 }}>
        <Btn kind="primary" label="Clone it" onPress={add} disabled={busy || !name.trim() || !repo.trim()} style={{ flex: 1 }} />
        <Btn label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

export default function Projects() {
  const { projects, busy, node } = useConnection();
  const router = useRouter();
  return (
    <Screen>
      <Header
        parent="totos"
        onBack={() => router.push('/nodes')}
        title={node?.name ?? 'toto'}
        right={<Btn label="settings" onPress={() => router.push('/device')} spoken={`Settings for ${node?.name ?? 'this Toto'}`} style={{ minHeight: 32, paddingHorizontal: 10 }} />}
      />
      <View style={{ flex: 1 }}>
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ProjectRow project={item} />}
          ListEmptyComponent={<Empty>No projects yet. A project is a git repo your agents work in.</Empty>}
          ListFooterComponent={
            busy ? (
              <View style={[styles.row, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={styles.faceCol}><Face mood="working" size={13} /></View>
                <Txt tone="ghost">Cloning…</Txt>
              </View>
            ) : (
              <AddProject />
            )
          }
        />
      </View>
      <StatusLine />
    </Screen>
  );
}
