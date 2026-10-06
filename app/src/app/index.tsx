import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Button, FlatList, Pressable, Share, Text, TextInput, View } from 'react-native';
import { useConnection, type Identity } from '../connection';
import { styles } from '../styles';

function AuthorForm({ identity }: { identity: Identity }) {
  const { request, busy } = useConnection();
  const [name, setName] = useState(identity.name);
  const [email, setEmail] = useState(identity.email);
  const changed = name.trim() !== identity.name || email.trim() !== identity.email;
  return (
    <View style={styles.form}>
      <Text style={styles.rowTitle}>Commit author</Text>
      <Text style={styles.muted}>Agents make their git commits under this name and email.</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" accessibilityLabel="Commit author name" />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" accessibilityLabel="Commit author email" />
      <Button title="Save author" onPress={() => request({ type: 'set_identity', name, email })} disabled={busy || !changed || !name.trim() || !email.trim()} />
    </View>
  );
}

export default function Projects() {
  const { projects, agents, identity, sshKey, request, busy } = useConnection();
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');

  const add = () => {
    request({ type: 'create_project', name, repo });
    setName('');
    setRepo('');
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Projects' }} />
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Text style={[styles.muted, styles.row]}>No projects yet. Add a repository below.</Text>}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/project/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.row} accessibilityRole="button">
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.muted}>
                {item.repo} · {agents.filter((a) => a.projectId === item.id).length} agents
              </Text>
            </Pressable>
          </Link>
        )}
        ListFooterComponent={
          <View style={styles.form}>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Project name" accessibilityLabel="Project name" />
            <TextInput style={styles.input} value={repo} onChangeText={setRepo} placeholder="git@github.com:owner/repo.git" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Repository address" />
            <Button title={busy ? 'Cloning…' : 'Add project'} onPress={add} disabled={busy || !name.trim() || !repo.trim()} />
            {/* Keyed on the saved value so the fields follow it, including when another device changes it. */}
            {identity && <AuthorForm key={`${identity.name}\n${identity.email}`} identity={identity} />}
            {!!sshKey && (
              <View style={styles.form}>
                <Text style={styles.rowTitle}>SSH key for this Toto</Text>
                <Text style={styles.muted}>Add it to your git host so Toto can clone and push. On GitHub: Settings, then SSH and GPG keys, then New SSH key.</Text>
                <Text style={styles.mono} selectable>{sshKey}</Text>
                <Button title="Share key" onPress={() => Share.share({ message: sshKey })} />
              </View>
            )}
          </View>
        }
      />
    </View>
  );
}
