import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle } from 'react-native';
import { parse, withCursor, type Span } from './ansi';
import { useConnection, type TermKey } from './connection';
import { FILLER, typed } from './keys';
import { color, font, gutter, tap } from './theme';
import { Txt, Waiting } from './ui';

const FONT_SIZE = 12;
// IBM Plex Mono's advance width is 0.6em.
const CHAR_WIDTH = FONT_SIZE * 0.6;
const ROWS = 30;

// What a phone keyboard lacks or buries. A string is typed as it is; a key is pressed.
const EXTRA: { label: string; spoken: string; key?: TermKey; text?: string }[] = [
  { label: 'esc', spoken: 'Escape', key: 'escape' },
  { label: 'tab', spoken: 'Tab', key: 'tab' },
  { label: '^C', spoken: 'Control C', key: 'ctrl-c' },
  { label: '↑', spoken: 'Up arrow', key: 'up' },
  { label: '↓', spoken: 'Down arrow', key: 'down' },
  { label: '←', spoken: 'Left arrow', key: 'left' },
  { label: '→', spoken: 'Right arrow', key: 'right' },
  { label: '/', spoken: 'Slash', text: '/' },
  { label: '-', spoken: 'Dash', text: '-' },
  { label: '|', spoken: 'Pipe', text: '|' },
  { label: '~', spoken: 'Tilde', text: '~' },
  { label: 'home', spoken: 'Home', key: 'home' },
  { label: 'end', spoken: 'End', key: 'end' },
  { label: 'pgup', spoken: 'Page up', key: 'pageup' },
  { label: 'pgdn', spoken: 'Page down', key: 'pagedown' },
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

/** A terminal agent: the session's screen in colour, typed into a key at a time. */
export function Terminal({ agentId }: { agentId: string }) {
  const { post, screens, status } = useConnection();
  const { width } = useWindowDimensions();
  const cols = Math.floor((width - 2 * gutter) / CHAR_WIDTH);
  const scroll = useRef<ScrollView>(null);
  // Follow new output, unless the reader has scrolled up into the history.
  const following = useRef(true);
  const online = status === 'open';
  const term = screens[agentId];

  // The keyboard types into an invisible field, and what changes in it is what was typed.
  const input = useRef<TextInput>(null);
  const [field, setField] = useState(FILLER);
  const seen = useRef(FILLER);
  const [typing, setTyping] = useState(false);
  // Armed by the ctrl key: the next letter typed is sent with control held.
  const [ctrl, setCtrl] = useState(false);

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

  const press = (text?: string, key?: TermKey) => {
    following.current = true; // typing means you want to see where you are typing
    post({ type: 'term_input', agentId, text, key });
  };

  const fieldChanged = (next: string) => {
    const { backspaces, text } = typed(seen.current, next);
    for (let i = 0; i < backspaces; i++) press(undefined, 'backspace');
    if (ctrl && /^[a-z]/i.test(text)) {
      press(undefined, `ctrl-${text[0].toLowerCase()}`);
      if (text.length > 1) press(text.slice(1));
      setCtrl(false);
    } else if (text) press(text);
    // Top the filler back up before backspace runs out of it, and stop the field growing for ever.
    seen.current = next.length < 10 || next.length > 400 ? FILLER : next;
    setField(seen.current);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: gutter, flexGrow: 1 }}
        keyboardShouldPersistTaps="always"
        onScrollEndDrag={userScrolled}
        onMomentumScrollEnd={userScrolled}
        onContentSizeChange={() => following.current && scroll.current?.scrollToEnd({ animated: false })}
        onLayout={() => following.current && scroll.current?.scrollToEnd({ animated: false })}>
        <Pressable onPress={() => input.current?.focus()} style={{ flexGrow: 1 }} accessibilityRole="button" accessibilityLabel="Terminal screen" accessibilityHint="Opens the keyboard to type into the terminal">
          {term ? (
            lines.map((line, i) => <Line key={i} spans={line.spans} id={line.id} />)
          ) : (
            // Keyed, so the seconds start again when the reason for waiting changes.
            <Waiting key={String(online)} hint={online ? 'The session is taking longer than usual to answer.' : undefined} after={6}>{online ? 'Opening the session…' : 'Reconnecting to your Toto…'}</Waiting>
          )}
        </Pressable>
      </ScrollView>

      <TextInput
        ref={input}
        style={local.hidden}
        value={field}
        onChangeText={fieldChanged}
        onSubmitEditing={() => press(undefined, 'enter')}
        submitBehavior="submit"
        onFocus={() => setTyping(true)}
        onBlur={() => setTyping(false)}
        editable={online}
        caretHidden
        contextMenuHidden
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        // The one Android keyboard type that reliably turns off predictions and reports each character.
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        keyboardAppearance="dark"
        accessibilityLabel="Terminal input"
      />

      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={local.keys} contentContainerStyle={{ gap: 6, paddingHorizontal: gutter, paddingVertical: 6 }}>
        <Key label={typing ? 'hide' : 'type'} spoken={typing ? 'Hide keyboard' : 'Show keyboard'} lit={typing} onPress={() => (typing ? Keyboard.dismiss() : input.current?.focus())} />
        <Key label="ctrl" spoken="Control, for the next letter" lit={ctrl} onPress={() => setCtrl(!ctrl)} />
        {EXTRA.map((k) => (
          <Key key={k.label} label={k.label} spoken={k.spoken} onPress={() => press(k.text, k.key)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Key({ label, spoken, lit, onPress }: { label: string; spoken: string; lit?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ selected: !!lit }} style={({ pressed }) => [local.key, lit && local.lit, pressed && { backgroundColor: color.rule }]}>
      <Txt tone={lit ? 'amber' : 'phosphor'}>{label}</Txt>
    </Pressable>
  );
}

const local = StyleSheet.create({
  line: { color: color.phosphor, fontFamily: font.regular, fontSize: FONT_SIZE, lineHeight: Math.round(FONT_SIZE * 1.35) },
  // Has to be laid out to take focus, so it is a single invisible point, not display:none.
  hidden: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, padding: 0 },
  keys: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule, backgroundColor: color.bezel },
  key: { minWidth: tap, minHeight: tap - 6, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tube, borderRadius: 4, borderBottomWidth: 2, borderBottomColor: color.rule },
  lit: { borderBottomColor: color.amber },
});
