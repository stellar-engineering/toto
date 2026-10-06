import { useEffect, useRef, useState } from 'react';
import { Button, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useConnection, type TermKey } from './connection';
import { styles } from './styles';

const FONT_SIZE = 12;
// Both platforms' monospace fonts are 0.6em wide, near enough.
const CHAR_WIDTH = FONT_SIZE * 0.602;
const ROWS = 30;

const KEYS: [label: string, key: TermKey, spoken: string][] = [
  ['esc', 'escape', 'Escape'],
  ['tab', 'tab', 'Tab'],
  ['↑', 'up', 'Up arrow'],
  ['↓', 'down', 'Down arrow'],
  ['←', 'left', 'Left arrow'],
  ['→', 'right', 'Right arrow'],
  ['⌫', 'backspace', 'Backspace'],
  ['^C', 'ctrl-c', 'Control C'],
  ['^D', 'ctrl-d', 'Control D'],
];

/** A terminal agent: the session's screen as text, a line to type into it, and the keys a phone keyboard lacks. */
export function Terminal({ agentId }: { agentId: string }) {
  const { post, screens } = useConnection();
  const { width } = useWindowDimensions();
  const cols = Math.floor((width - 32) / CHAR_WIDTH);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    post({ type: 'term_open', agentId, cols, rows: ROWS });
    return () => post({ type: 'term_close', agentId });
    // `post` is a new function each render; the session only needs reopening when its target or size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cols]);

  const send = () => {
    post({ type: 'term_input', agentId, text: draft, key: 'enter' });
    setDraft('');
  };

  return (
    // ponytail: the offset is a guess at the header's height, as on the chat screen.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView ref={scroll} style={{ flex: 1 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Text style={[styles.mono, { fontSize: FONT_SIZE }]} selectable accessibilityLabel="Terminal screen">
          {screens[agentId] ?? 'Connecting to the terminal…'}
        </Text>
      </ScrollView>
      <ScrollView horizontal keyboardShouldPersistTaps="always" style={{ flexGrow: 0 }} contentContainerStyle={styles.actions}>
        {KEYS.map(([label, key, spoken]) => (
          <Button key={key} title={label} accessibilityLabel={spoken} onPress={() => post({ type: 'term_input', agentId, key })} />
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput style={[styles.input, styles.grow, styles.mono]} value={draft} onChangeText={setDraft} onSubmitEditing={send} submitBehavior="submit" placeholder="Type a command" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Command" />
        <Button title="Enter" onPress={send} />
      </View>
    </KeyboardAvoidingView>
  );
}
