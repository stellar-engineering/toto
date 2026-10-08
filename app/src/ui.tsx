import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from './connection';
import { Face, prefersStill, type Mood } from './face';
import { color, font, gutter, size, tap } from './theme';

type Tone = keyof typeof color;

/** All text in the app. */
export function Txt({ tone = 'phosphor', weight = 'regular', small, style, ...rest }: TextProps & { tone?: Tone; weight?: keyof typeof font; small?: boolean }) {
  return <Text {...rest} style={[{ color: color[tone], fontFamily: font[weight], fontSize: small ? size.small : size.body, lineHeight: small ? 18 : 22 }, style]} />;
}

const TICK = ['|', '/', '-', '\\'];
const BAR = ['[=   ]', '[==  ]', '[ == ]', '[  ==]', '[   =]', '[    ]'];

/**
 * Something is happening. Characters swapped in place, like the mark: one that turns, for inside a
 * button, or a bar with a block running along it, for a line of its own. Decoration: the words
 * beside it say what is happening.
 */
export function Spinner({ wide, tone = 'amber' }: { wide?: boolean; tone?: Tone }) {
  const frames = wide ? BAR : TICK;
  const [at, setAt] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    let alive = true;
    prefersStill().then((yes) => alive && setStill(yes));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setAt((i) => i + 1), wide ? 140 : 110);
    return () => clearInterval(timer);
  }, [still, wide]);
  return (
    <Txt tone={tone} weight="bold" allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no">
      {still ? (wide ? '[ .. ]' : '~') : frames[at % frames.length]}
    </Txt>
  );
}

/** Seconds since this was first shown. */
function useElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * A line saying what is being waited for. After a few seconds it also says how long it has been,
 * so a long wait reads as still going and not as stuck; `hint` appears once the wait has run
 * past `after` seconds, for what to expect or what to try.
 */
export function Waiting({ children, hint, after = 8, tone = 'ghost', style }: { children: ReactNode; hint?: string; after?: number; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const seconds = useElapsed();
  return (
    <View style={style} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Spinner wide tone={tone === 'ghost' ? 'amber' : tone} />
        <Txt tone={tone} style={{ flex: 1 }}>
          {children}
          {seconds >= 4 && <Txt tone={tone} small>{`  ${seconds}s`}</Txt>}
        </Txt>
      </View>
      {!!hint && seconds >= after && <Txt tone={tone} small style={{ marginTop: 6 }}>{hint}</Txt>}
    </View>
  );
}

export function Btn({ label, onPress, kind = 'plain', disabled, busy, style, spoken }: { label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; /** Doing what it was pressed for: it turns, and cannot be pressed again. */ busy?: boolean; style?: StyleProp<ViewStyle>; spoken?: string }) {
  const ink: Tone = kind === 'primary' ? 'tube' : kind === 'danger' ? 'raspberry' : 'phosphor';
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [styles.btn, kind === 'primary' && styles.btnPrimary, kind === 'danger' && styles.btnDanger, (pressed || off) && { opacity: busy ? 0.75 : disabled ? 0.35 : 0.6 }, style]}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {busy && <Spinner tone={ink} />}
        <Txt tone={ink} weight="medium">{label}</Txt>
      </View>
    </Pressable>
  );
}

/** A setting on one line: its name, then its value to edit. */
export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Txt tone="ghost" style={styles.fieldLabel}>{label}</Txt>
      <TextInput accessibilityLabel={label} placeholderTextColor={color.hint} autoCapitalize="none" autoCorrect={false} selectionColor={color.amber} keyboardAppearance="dark" {...input} style={[styles.input, input.style]} />
    </View>
  );
}

/** A yes/no choice drawn as a terminal checkbox. */
export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} style={styles.check}>
      <Txt tone={value ? 'amber' : 'ghost'}>{value ? '[x]' : '[ ]'}</Txt>
      <Txt style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

/** The top line of a screen: where you are, the way back, and anything the screen adds on the right. */
export function Header({ parent, title, right, onBack }: { parent?: string; title: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter();
  const wide = useWide();
  return (
    <View style={styles.header}>
      {/* Beside the sidebar there is no "back": where you are in the Toto is on show down the left. */}
      {parent !== undefined && !wide && (
        <Pressable onPress={onBack ?? (() => router.back())} accessibilityRole="button" accessibilityLabel={`Go to ${parent}`} hitSlop={12} style={styles.back}>
          <Txt tone="ghost" numberOfLines={1}>{`‹ ${parent} /`}</Txt>
        </Pressable>
      )}
      <Txt weight="bold" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">{title}</Txt>
      {right}
    </View>
  );
}

/** Wide enough, in a browser, for the sidebar: everything on the Toto down the left and a screen beside it. */
export function useWide() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= 900;
}

/**
 * The bottom line of the list screens: how we are reaching the Toto, and who needs attention.
 * On a wide screen the sidebar carries it (`always`), and the screens beside it leave it out.
 */
export function StatusLine({ always }: { always?: boolean }) {
  const wide = useWide();
  if (wide && !always) return null;
  return <StatusBar brief={wide} />;
}

/** `brief` leaves the counts out: in the sidebar, each agent's state is already beside its name. */
function StatusBar({ brief }: { brief: boolean }) {
  const router = useRouter();
  const { status, via, tally, trying } = useConnection();
  const { bottom } = useSafeAreaInsets();
  const linked = status === 'open';
  const reaching = trying.why === 'refused' ? 'access taken away' : trying.phase === 'local' ? 'looking on this network' : trying.phase === 'relay' ? 'trying the relay' : trying.why === 'offline' ? 'your Toto is offline' : 'no answer, trying again';
  return (
    <Pressable onPress={() => router.push('/device')} accessibilityRole="button" accessibilityLabel="Connection and device settings" style={[styles.status, { paddingBottom: bottom, minHeight: tap + bottom }]}>
      <Face mood={!linked ? 'looking' : tally.waiting ? 'waiting' : tally.working ? 'working' : 'awake'} size={12} />
      <Txt small tone={linked ? 'phosphor' : 'amber'} style={{ flex: 1 }}>{linked ? (via === 'relay' ? 'relay' : 'local network') : reaching}</Txt>
      {!brief && tally.working > 0 && <Txt small tone="signal">{tally.working} working</Txt>}
      {!brief && tally.waiting > 0 && <Txt small tone="amber" weight="bold">{tally.waiting} waiting on you</Txt>}
    </Pressable>
  );
}

export function Screen({ children, bare }: { children: ReactNode; bare?: boolean }) {
  // With the keyboard up there is no home indicator to clear, so the bottom inset would only be a gap.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTyping(true));
    const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTyping(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return (
    // Keyboard avoidance has to be the outermost view: it measures from its own top edge, so
    // anything above it (a header, the status bar) would leave it that much short.
    // On Android too: the app draws edge to edge there, so the system no longer resizes it for the keyboard.
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <SafeAreaView style={{ flex: 1 }} edges={bare && !typing ? ['top', 'bottom'] : ['top']}>
        {children}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

export const Rule = () => <View style={styles.rule} />;

/** What a list or a conversation shows when there is nothing in it yet: Toto, and a line about what goes here. */
export function Empty({ mood = 'awake', children }: { mood?: Mood; children: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Face mood={mood} size={34} nose />
      <Txt tone="ghost" style={{ textAlign: 'center', maxWidth: 300 }}>{children}</Txt>
    </View>
  );
}

/** A screen's worth of waiting, for something that is on its way and has nothing to show yet. */
export function Loading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Face mood="looking" size={34} nose />
      <Waiting hint={hint} style={{ maxWidth: 320 }}>{children}</Waiting>
    </View>
  );
}

/**
 * What a screen shows in place of its contents while the Toto has not yet said what it holds:
 * which way it is being reached right now, or why it cannot be, and a way out once that has
 * gone on a while. `what` names the thing being fetched, like "your projects".
 */
export function Reaching({ what }: { what: string }) {
  const router = useRouter();
  const { status, node, trying } = useConnection();
  const name = node?.name ?? 'your Toto';
  const stuck = status !== 'open' && (trying.tries >= 2 || trying.why === 'refused');
  // Once it has failed a couple of times, say why and keep saying it: narrating each retry would
  // have the line change every few seconds for as long as the Toto stays away.
  const [line, hint] =
    status === 'open'
      ? [`Connected. Fetching ${what}…`, 'A Toto with long conversations takes a little longer.']
      : trying.phase === 'local' && !stuck
        ? [`Looking for ${name} on this network…`, undefined]
        : trying.phase === 'relay' && !stuck
          ? [`Not on this network. Trying the relay…`, 'On a slow connection this can take ten seconds.']
          : trying.why === 'offline'
            ? [`${name} is not connected to the relay.`, 'It may be switched off, or have lost its internet. Trying again every few seconds.']
            : trying.why === 'lost'
              ? [`Lost the line to ${name}. Reconnecting…`, undefined]
              : trying.why === 'refused'
                ? [`This ${Platform.OS === 'web' ? 'browser' : 'phone'} no longer has access to ${name}.`, 'Whoever shared it has taken that back. They can share it again; until then you can forget it in connection settings.']
              : [`${name} did not answer.`, node?.relay ? 'Tried this network and the relay. Trying again every few seconds.' : 'No relay is set, so it can only be reached on its own network. Trying again every few seconds.'];
  return (
    <View style={styles.empty}>
      <Face mood={stuck ? 'offline' : 'looking'} size={34} nose />
      {trying.why === 'refused' && status !== 'open' ? (
        // Nothing is being waited for: this does not change until someone shares it again.
        <View style={{ maxWidth: 320, gap: 6 }}>
          <Txt>{line}</Txt>
          <Txt tone="ghost" small>{hint}</Txt>
        </View>
      ) : (
        // Keyed on the line, so the seconds count each stage and not the whole wait.
        <Waiting key={line} hint={hint} after={stuck ? 0 : 6} style={{ maxWidth: 320 }}>{line}</Waiting>
      )}
      {stuck && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Btn label="Connection settings" onPress={() => router.push('/device')} />
          <Btn label="Other Totos" onPress={() => router.push('/nodes')} />
        </View>
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.tube },
  pad: { paddingHorizontal: gutter },
  // Text to read and forms to fill stop at a comfortable width however wide the window is; lists and terminals use it all.
  readable: { width: '100%', maxWidth: 760 },
  // A conversation: wider than prose, for the code in it, but not a line a whole monitor long.
  talk: { width: '100%', maxWidth: 1040 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: tap, paddingHorizontal: gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.rule },
  back: { minHeight: tap, justifyContent: 'center', maxWidth: '45%' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: tap, paddingHorizontal: gutter, backgroundColor: color.bezel },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.rule },
  row: { minHeight: 64, justifyContent: 'center', paddingHorizontal: gutter, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.rule },
  btn: { minHeight: tap, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.rule, borderRadius: 2 },
  btnPrimary: { backgroundColor: color.amber, borderColor: color.amber },
  btnDanger: { borderColor: color.raspberry },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: tap, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.rule },
  fieldLabel: { width: 84 },
  // No browser focus ring: the line under a field, and the caret in it, already say where you are.
  input: { flex: 1, color: color.phosphor, fontFamily: font.regular, fontSize: size.body, paddingVertical: 10, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: tap },
  form: { paddingHorizontal: gutter, paddingVertical: 12, gap: 4, width: '100%', maxWidth: 760 },
  empty: { alignItems: 'center', gap: 20, paddingHorizontal: gutter, paddingTop: 56, paddingBottom: 32 },
  // The column a face sits in at the start of a row, so names line up down a list.
  faceCol: { width: 52 },
});
