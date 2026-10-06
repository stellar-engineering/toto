import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle } from 'react-native';
import { parse, withCursor, type Span } from './ansi';
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

function spanStyle(span: Span & { cursor?: boolean }): TextStyle {
  if (span.cursor) return { backgroundColor: color.amber, color: color.tube };
  // Reverse video swaps the two colours, falling back to the screen's own when one is unset.
  const fg = span.inverse ? (span.bg ?? color.tube) : (span.fg ?? (span.dim ? color.ghost : undefined));
  const bg = span.inverse ? (span.fg ?? color.phosphor) : span.bg;
  return {
    color: fg,
    backgroundColor: bg,
    fontFamily: span.bold ? font.bold : span.italic ? font.italic : undefined,
    textDecorationLine: span.underline && span.strike ? 'underline line-through' : span.underline ? 'underline' : span.strike ? 'line-through' : undefined,
  };
}

/** One row of the screen. Rows that have not changed are not drawn again. */
const Line = memo(
  function Line({ spans }: { spans: (Span & { cursor?: boolean })[]; id: string }) {
    return (
      <Text style={local.line}>
        {spans.length ? spans.map((span, i) => <Text key={i} style={spanStyle(span)}>{span.text}</Text>) : ' '}
      </Text>
    );
  },
  (a, b) => a.id === b.id,
);

/** A terminal agent: the session's screen in colour, a line to type into it, and the keys a phone keyboard lacks. */
export function Terminal({ agentId }: { agentId: string }) {
  const { post, screens, status } = useConnection();
  const { width } = useWindowDimensions();
  const cols = Math.floor((width - 2 * gutter) / CHAR_WIDTH);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  // Follow new output, unless the reader has scrolled up into the history.
  const following = useRef(true);
  const online = status === 'open';
  const term = screens[agentId];

  useEffect(() => {
    if (!online) return;
    post({ type: 'term_open', agentId, cols, rows: ROWS });
    return () => post({ type: 'term_close', agentId });
    // `post` is a new function each render; the session only needs reopening when its target,
    // its size or the connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cols, online]);

  // The view shrinks while the keyboard slides in, so the bottom can only be found once it has
  // finished. Without this the prompt ends up cut off below the visible rows.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => following.current && scroll.current?.scrollToEnd({ animated: true }));
    return () => shown.remove();
  }, []);

  const lines = useMemo(() => {
    if (!term) return [];
    return parse(term.screen).map((spans, row) => {
      const withIt = row === term.cursor.row ? withCursor(spans, term.cursor.col) : spans;
      return { spans: withIt, id: JSON.stringify(withIt) };
    });
  }, [term]);

  // Only a scroll the reader made counts. When the keyboard opens the view shrinks and reports a
  // scroll of its own, which must not be mistaken for someone scrolling up to read.
  const userScrolled = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    following.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 40;
  };

  const send = () => {
    post({ type: 'term_input', agentId, text: draft, key: 'enter' });
    setDraft('');
    following.current = true;
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: gutter }}
        onScrollEndDrag={userScrolled}
        onMomentumScrollEnd={userScrolled}
        onContentSizeChange={() => following.current && scroll.current?.scrollToEnd({ animated: false })}
        onLayout={() => following.current && scroll.current?.scrollToEnd({ animated: false })}>
        {term ? (
          <View accessible accessibilityLabel="Terminal screen">
            {lines.map((line, i) => (
              <Line key={i} spans={line.spans} id={line.id} />
            ))}
          </View>
        ) : (
          <Txt tone="ghost">{online ? 'Opening the session…' : 'Reconnecting to your Toto…'}</Txt>
        )}
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
          style={ui.input}
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
  line: { color: color.phosphor, fontFamily: font.regular, fontSize: FONT_SIZE, lineHeight: Math.round(FONT_SIZE * 1.35) },
  keys: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule },
  key: { minWidth: tap, minHeight: tap - 6, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bezel, borderRadius: 4, borderBottomWidth: 2, borderBottomColor: color.rule },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: gutter, paddingVertical: 8, backgroundColor: color.bezel },
});
