import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useConnection, type Project } from '../connection';
import { Face } from '../face';
import { moodOfMany } from '../moods';
import { Btn, Empty, Field, Header, Reaching, Screen, StatusLine, Txt, Waiting, styles } from '../ui';

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
  const { request, busy, sshKey, status } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  // Nothing can be asked of a Toto that is not there, and asking would silently do nothing.
  if (status !== 'open')
    return (
      <View style={styles.row} accessibilityState={{ disabled: true }}>
        <Txt tone="ghost">+ Add a project</Txt>
        <Txt tone="ghost" small>Once your Toto is reached again.</Txt>
      </View>
    );
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
  const { projects, pending, loaded, node, claude } = useConnection();
  const router = useRouter();
  return (
    <Screen>
      <Header
        parent="totos"
        onBack={() => router.push('/nodes')}
        title={node?.name ?? 'toto'}
        right={<Btn label="settings" onPress={() => router.push('/device')} spoken={`Settings for ${node?.name ?? 'this Toto'}`} style={{ minHeight: 32, paddingHorizontal: 10 }} />}
      />
      {/* Nothing an agent does works until this is done, so it sits above everything until it is. */}
      {claude === 'none' && (
        <Pressable onPress={() => router.push('/claude')} style={[styles.row, { flexDirection: 'row', alignItems: 'center' }]} accessibilityRole="button">
          <View style={styles.faceCol}><Face mood="waiting" size={13} /></View>
          <View style={{ flex: 1 }}>
            <Txt tone="amber" weight="bold">Sign in to Claude</Txt>
            <Txt tone="ghost" small>Your agents cannot work until this Toto is signed in.</Txt>
          </View>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        {/* Until the Toto has said what it holds, an empty list would be a guess. */}
        {!loaded ? <Reaching what="your projects" /> : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <ProjectRow project={item} />}
          ListEmptyComponent={pending?.type === 'create_project' ? null : <Empty>No projects yet. A project is a git repo your agents work in.</Empty>}
          ListFooterComponent={
            pending?.type === 'create_project' ? (
              // Where the project will be, while it is being fetched.
              <View style={[styles.row, { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }]}>
                <View style={styles.faceCol}><Face mood="working" size={13} /></View>
                <View style={{ flex: 1 }}>
                  <Txt weight="bold" numberOfLines={1}>{pending.name}</Txt>
                  <Waiting hint="A large repository can take a few minutes. You can leave this screen." after={15}>Cloning…</Waiting>
                </View>
              </View>
            ) : (
              <AddProject />
            )
          }
        />
        )}
      </View>
      <StatusLine />
    </Screen>
  );
}
