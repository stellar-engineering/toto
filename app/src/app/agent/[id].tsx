import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Button, FlatList, KeyboardAvoidingView, Platform, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConnection, type AgentEvent } from '../../connection';
import { styles } from '../../styles';
import { Terminal } from '../../terminal';

const NO_EVENTS: AgentEvent[] = [];

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

export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { agents, events: all, post } = useConnection();
  const agent = agents.find((a) => a.id === id);
  const events = all[id] ?? NO_EVENTS;
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<AgentEvent>>(null);

  const send = () => {
    if (!draft.trim()) return;
    post({ type: 'prompt', agentId: id, text: draft });
    setDraft('');
  };

  const toggleAuto = (on: boolean) => {
    if (!on) return post({ type: 'set_mode', agentId: id, mode: 'ask' });
    Alert.alert('Turn on full auto?', 'This agent will run commands and change files without asking, including anything waiting for approval now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn on', style: 'destructive', onPress: () => post({ type: 'set_mode', agentId: id, mode: 'auto' }) },
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

  if (agent?.harness === 'terminal')
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title: agent.name }} />
        <Terminal agentId={id} />
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: agent?.name ?? 'Agent',
          headerRight: () => (
            <View style={styles.option}>
              <Text nativeID="auto-label">Full auto</Text>
              <Switch value={agent?.mode === 'auto'} onValueChange={toggleAuto} accessibilityLabelledBy="auto-label" accessibilityLabel="Full auto" />
            </View>
          ),
        }}
      />
      {/* ponytail: the offset is a guess at the header's height; measure it if the composer hides behind the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(_, i) => String(i)}
          onContentSizeChange={() => list.current?.scrollToEnd()}
          ListEmptyComponent={<Text style={[styles.muted, styles.row]}>Tell this agent what to do.</Text>}
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
                    <Button title="Approve" onPress={() => post({ type: 'approve', agentId: id, id: callId, allow: true })} />
                    <Button title="Deny" color="#b00020" onPress={() => post({ type: 'approve', agentId: id, id: callId, allow: false })} />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
