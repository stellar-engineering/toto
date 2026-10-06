import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useConnection, type TermKey } from './connection';
import { color, font, gutter, tap } from './theme';
import { Btn, Txt, styles as ui } from './ui';

const FONT_SIZE = 12;
// IBM Plex Mono's advance width is 0.6em.
const CHAR_WIDTH = FONT_SIZE * 0.6;
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
  const { post, screens, status } = useConnection();
  const { width } = useWindowDimensions();
  const cols = Math.floor((width - 2 * gutter) / CHAR_WIDTH);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const online = status === 'open';

  useEffect(() => {
    if (!online) return;
    post({ type: 'term_open', agentId, cols, rows: ROWS });
    return () => post({ type: 'term_close', agentId });
    // `post` is a new function each render; the session only needs reopening when its target,
    // its size or the connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cols, online]);

  const send = () => {
    post({ type: 'term_input', agentId, text: draft, key: 'enter' });
    setDraft('');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: gutter }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Txt selectable accessibilityLabel="Terminal screen" style={{ fontSize: FONT_SIZE, lineHeight: FONT_SIZE * 1.35 }}>
          {screens[agentId] ?? (online ? 'Opening the session…' : 'Reconnecting to your Toto…')}
        </Txt>
      </ScrollView>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={local.keys} contentContainerStyle={{ gap: 6, paddingHorizontal: gutter, paddingVertical: 6 }}>
        {KEYS.map(([label, key, spoken]) => (
          <Pressable key={key} onPress={() => post({ type: 'term_input', agentId, key })} accessibilityRole="button" accessibilityLabel={spoken} style={({ pressed }) => [local.key, pressed && { backgroundColor: color.rule }]}>
            <Txt>{label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
      <View style={local.composer}>
        <Txt tone="amber" weight="bold" style={{ paddingVertical: 11 }}>$</Txt>
        <TextInput
          style={[ui.input, { fontFamily: font.regular }]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          submitBehavior="submit"
          placeholder="Type a command"
          placeholderTextColor={color.ghost}
          selectionColor={color.amber}
          keyboardAppearance="dark"
          autoCapitalize="none"
          autoCorrect={false}
          editable={online}
          accessibilityLabel="Command"
        />
        <Btn kind="primary" label="Enter" onPress={send} disabled={!online} />
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  keys: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule },
  key: { minWidth: tap, minHeight: tap - 6, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bezel, borderRadius: 4, borderBottomWidth: 2, borderBottomColor: color.rule },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: gutter, paddingVertical: 8, backgroundColor: color.bezel },
});
