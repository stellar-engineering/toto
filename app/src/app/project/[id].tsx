import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, FlatList, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useConnection } from '../../connection';
import { styles } from '../../styles';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { projects, agents, request, busy } = useConnection();
  const project = projects.find((p) => p.id === id);
  const [name, setName] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [auto, setAuto] = useState(false);

  const start = () => {
    request({ type: 'create_agent', projectId: id, name, worktree, mode: auto ? 'auto' : 'ask' });
    setName('');
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: project?.name ?? 'Project' }} />
      <FlatList
        data={agents.filter((a) => a.projectId === id)}
        keyExtractor={(a) => a.id}
        ListEmptyComponent={<Text style={[styles.muted, styles.row]}>No agents yet. Start one below.</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/agent/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row} accessibilityRole="button">
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.worktree ? 'Own branch' : 'Main checkout'} · {item.mode === 'auto' ? 'Full auto' : 'Asks first'}
              </Text>
            </Pressable>
          </Link>
        )}
        ListFooterComponent={
          <View style={styles.form}>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Agent name" accessibilityLabel="Agent name" />
            <View style={styles.option}>
              <Text>Own branch, so it cannot clash with other agents</Text>
              <Switch value={worktree} onValueChange={setWorktree} accessibilityLabel="Own branch" />
            </View>
            <View style={styles.option}>
              <Text>Full auto, without asking before it acts</Text>
              <Switch value={auto} onValueChange={setAuto} accessibilityLabel="Full auto" />
            </View>
            <Button title={busy ? 'Starting…' : 'Start agent'} onPress={start} disabled={busy || !name.trim()} />
          </View>
        }
      />
    </View>
  );
}
