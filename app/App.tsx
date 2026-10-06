import { StatusBar } from 'expo-status-bar';
import { useMemo, useRef, useState } from 'react';
import { Alert, Button, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AgentEvent, ClientMessage, Mode, ServerMessage } from '../protocol';

const describe = (e: AgentEvent): string => {
  switch (e.type) {
    case 'user':
    case 'text':
      return e.text;
    case 'tool_call':
    case 'approval_request':
      return `${e.name} ${JSON.stringify(e.input)}`;
    case 'approval_resolved':
      return '';
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
  const [mode, setMode] = useState<Mode>('ask');
  const socket = useRef<WebSocket | null>(null);
  const list = useRef<FlatList<AgentEvent>>(null);

  const connect = () => {
    setStatus('connecting');
    setNotice('');
    setEvents([]); // the server replays the full history on connect
    const ws = new WebSocket(`${url.trim()}/?token=${encodeURIComponent(token.trim())}`);
    socket.current = ws;
    ws.onopen = () => setStatus('open');
    ws.onmessage = (m) => {
      const msg: ServerMessage = JSON.parse(m.data);
      if (msg.type === 'mode') setMode(msg.mode);
      else setEvents((prev) => [...prev, msg]);
    };
    ws.onclose = () => {
      setStatus((was) => {
        setNotice(was === 'open' ? 'Connection lost.' : 'Could not connect. Check the address and token.');
        return 'idle';
      });
    };
  };

  const post = (message: ClientMessage) => socket.current?.send(JSON.stringify(message));

  const send = () => {
    if (!draft.trim()) return;
    post({ type: 'prompt', text: draft });
    setDraft('');
  };

  const toggleAuto = (on: boolean) => {
    if (!on) return post({ type: 'set_mode', mode: 'ask' });
    Alert.alert('Turn on full auto?', 'Your agent will run commands and change files without asking, including anything waiting for approval now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn on', style: 'destructive', onPress: () => post({ type: 'set_mode', mode: 'auto' }) },
    ]);
  };

  // Approval events decorate the tool call they belong to rather than taking a row of their own.
  const { rows, decisions } = useMemo(() => {
    const calls = new Set(events.flatMap((e) => (e.type === 'tool_call' ? [e.id] : [])));
    const decisions = new Map<string, boolean | 'waiting'>();
    for (const e of events) {
      if (e.type === 'approval_request') decisions.set(e.id, 'waiting');
      if (e.type === 'approval_resolved') decisions.set(e.id, e.allowed);
    }
    const rows = events.filter((e) => (e.type === 'approval_request' ? !calls.has(e.id) : e.type !== 'approval_resolved'));
    return { rows, decisions };
  }, [events]);

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
      <View style={styles.header}>
        <Text nativeID="auto-label">Full auto</Text>
        <Switch value={mode === 'auto'} onValueChange={toggleAuto} accessibilityLabelledBy="auto-label" accessibilityLabel="Full auto" />
      </View>
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(_, i) => String(i)}
        onContentSizeChange={() => list.current?.scrollToEnd()}
        renderItem={({ item }) => {
          const callId = item.type === 'tool_call' || item.type === 'approval_request' ? item.id : undefined;
          const isCall = callId !== undefined;
          const decision = isCall ? decisions.get(callId) : undefined;
          return (
            <View style={[styles.event, item.type === 'user' && styles.user]}>
              {item.type !== 'user' && item.type !== 'text' && <Text style={styles.label}>{isCall ? 'tool call' : item.type.replace('_', ' ')}</Text>}
              <Text style={isCall || item.type === 'tool_result' ? styles.mono : undefined} numberOfLines={item.type === 'tool_result' ? 12 : undefined}>
                {describe(item)}
              </Text>
              {isCall && decision === 'waiting' && (
                <View style={styles.actions}>
                  <Button title="Approve" onPress={() => post({ type: 'approve', id: callId, allow: true })} />
                  <Button title="Deny" color="#b00020" onPress={() => post({ type: 'approve', id: callId, allow: false })} />
                </View>
              )}
              {decision === false && <Text style={styles.notice}>Denied</Text>}
            </View>
          );
        }}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingBottom: 8 },
  actions: { flexDirection: 'row', gap: 16, paddingTop: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
});
