import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, FlatList, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useConnection } from '../../connection';
import { styles } from '../../styles';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { projects, agents, post, request, busy } = useConnection();
  const router = useRouter();
  const project = projects.find((p) => p.id === id);
  const [name, setName] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [auto, setAuto] = useState(false);
  const [terminal, setTerminal] = useState(false);

  const start = () => {
    request({ type: 'create_agent', projectId: id, name, harness: terminal ? 'terminal' : 'claude', worktree, mode: auto ? 'auto' : 'ask' });
    setName('');
  };

  const confirmDelete = (title: string, message: string, onDelete: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);

  const deleteProject = () =>
    confirmDelete(`Delete ${project?.name ?? 'this project'}?`, 'This removes its files from your Toto, along with every agent in it and any work they have not pushed.', () => {
      post({ type: 'delete_project', projectId: id });
      router.back();
    });

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.name ?? 'Project' }} />
      <FlatList
        data={agents.filter((a) => a.projectId === id)}
        keyExtractor={(a) => a.id}
        ListEmptyComponent={<Text style={[styles.muted, styles.row]}>No agents yet. Start one below.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.row, styles.option]}>
            <Link href={{ pathname: '/agent/[id]', params: { id: item.id } }} asChild>
              <Pressable style={{ flex: 1 }} accessibilityRole="button">
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.muted}>
                  {item.worktree ? 'Own branch' : 'Main checkout'} · {item.harness === 'terminal' ? 'Terminal' : item.mode === 'auto' ? 'Full auto' : 'Asks first'}
                </Text>
              </Pressable>
            </Link>
            <Button
              title="Delete"
              color="#b00020"
              accessibilityLabel={`Delete agent ${item.name}`}
              onPress={() =>
                confirmDelete(
                  `Delete ${item.name}?`,
                  item.worktree
                    ? 'This stops the agent and removes its conversation and any work it has not committed. Its branch is kept.'
                    : 'This stops the agent and removes its conversation. Files in the main checkout are left as they are.',
                  () => post({ type: 'delete_agent', agentId: item.id }),
                )
              }
            />
          </View>
        )}
        ListFooterComponent={
          <View style={styles.form}>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Agent name" accessibilityLabel="Agent name" />
            <View style={styles.option}>
              <Text style={{ flex: 1 }}>Own branch, so it cannot clash with other agents</Text>
              <Switch value={worktree} onValueChange={setWorktree} accessibilityLabel="Own branch" />
            </View>
            {/* ponytail: a switch while there are two kinds of agent; a picker when Codex and Gemini arrive. */}
            <View style={styles.option}>
              <Text style={{ flex: 1 }}>Plain terminal, to run any tool by hand</Text>
              <Switch value={terminal} onValueChange={setTerminal} accessibilityLabel="Plain terminal" />
            </View>
            {!terminal && (
              <View style={styles.option}>
                <Text style={{ flex: 1 }}>Full auto, without asking before it acts</Text>
                <Switch value={auto} onValueChange={setAuto} accessibilityLabel="Full auto" />
              </View>
            )}
            <Button title={busy ? 'Starting…' : 'Start agent'} onPress={start} disabled={busy || !name.trim()} />
            <View style={{ height: 24 }} />
            <Button title="Delete project" color="#b00020" onPress={deleteProject} />
          </View>
        }
      />
    </View>
  );
}
