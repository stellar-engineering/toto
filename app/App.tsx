import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Button, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AgentEvent, ClientMessage } from '../protocol';

const describe = (e: AgentEvent): string => {
  switch (e.type) {
    case 'user':
    case 'text':
      return e.text;
    case 'tool_call':
      return `${e.name} ${JSON.stringify(e.input)}`;
    case 'tool_result':
      return e.output;
    case 'done':
      return e.isError ? 'Finished with an error' : 'Finished';
    case 'error':
      return e.message;
  }
};

export default function App() {
  // ponytail: typed in by hand each launch. Replaced by Bluetooth pairing and mDNS discovery in M2.
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_TOTO_URL ?? 'ws://raspberrypi.local:7860');
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_TOTO_TOKEN ?? '');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open'>('idle');
  const [notice, setNotice] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [draft, setDraft] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const list = useRef<FlatList<AgentEvent>>(null);

  const connect = () => {
    setStatus('connecting');
    setNotice('');
    setEvents([]); // the server replays the full history on connect
    const ws = new WebSocket(`${url.trim()}/?token=${encodeURIComponent(token.trim())}`);
    socket.current = ws;
    ws.onopen = () => setStatus('open');
    ws.onmessage = (m) => setEvents((prev) => [...prev, JSON.parse(m.data)]);
    ws.onclose = () => {
      setStatus((was) => {
        setNotice(was === 'open' ? 'Connection lost.' : 'Could not connect. Check the address and token.');
        return 'idle';
      });
    };
  };

  const send = () => {
    if (!draft.trim()) return;
    const message: ClientMessage = { type: 'prompt', text: draft };
    socket.current?.send(JSON.stringify(message));
    setDraft('');
  };

  if (status !== 'open') {
    return (
      <View style={[styles.screen, styles.centred]}>
        <Text style={styles.title}>Toto</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder="ws://raspberrypi.local:7860" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Server address" />
        <TextInput style={styles.input} value={token} onChangeText={setToken} placeholder="Token" autoCapitalize="none" autoCorrect={false} secureTextEntry accessibilityLabel="Token" />
        <Button title={status === 'connecting' ? 'Connecting…' : 'Connect'} onPress={connect} disabled={status === 'connecting'} />
        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={list}
        data={events}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => list.current?.scrollToEnd()}
        renderItem={({ item }) => (
          <View style={[styles.event, item.type === 'user' && styles.user]}>
            {item.type !== 'user' && item.type !== 'text' && <Text style={styles.label}>{item.type.replace('_', ' ')}</Text>}
            <Text style={item.type === 'tool_call' || item.type === 'tool_result' ? styles.mono : undefined} numberOfLines={item.type === 'tool_result' ? 12 : undefined}>
              {describe(item)}
            </Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput style={[styles.input, styles.grow]} value={draft} onChangeText={setDraft} placeholder="Message your agent" multiline accessibilityLabel="Message" />
        <Button title="Send" onPress={send} />
      </View>
      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // ponytail: fixed top padding instead of safe-area insets; swap in when there is real navigation.
  screen: { flex: 1, backgroundColor: '#fff', paddingTop: 60, paddingHorizontal: 16, paddingBottom: 24 },
  centred: { justifyContent: 'center', gap: 12 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12, fontSize: 16 },
  grow: { flex: 1, maxHeight: 120 },
  notice: { color: '#b00020' },
  event: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  user: { backgroundColor: '#eef3ff', paddingHorizontal: 8, borderRadius: 8 },
  label: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginBottom: 2 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
});
