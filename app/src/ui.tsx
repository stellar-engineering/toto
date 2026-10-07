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
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from './connection';
import { Face, type Mood } from './face';
import { color, font, gutter, size, tap } from './theme';

type Tone = keyof typeof color;

/** All text in the app. */
export function Txt({ tone = 'phosphor', weight = 'regular', small, style, ...rest }: TextProps & { tone?: Tone; weight?: keyof typeof font; small?: boolean }) {
  return <Text {...rest} style={[{ color: color[tone], fontFamily: font[weight], fontSize: small ? size.small : size.body, lineHeight: small ? 18 : 22 }, style]} />;
}

export function Btn({ label, onPress, kind = 'plain', disabled, style, spoken }: { label: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; style?: StyleProp<ViewStyle>; spoken?: string }) {
  const ink: Tone = kind === 'primary' ? 'tube' : kind === 'danger' ? 'raspberry' : 'phosphor';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.btn, kind === 'primary' && styles.btnPrimary, kind === 'danger' && styles.btnDanger, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }, style]}>
      <Txt tone={ink} weight="medium">{label}</Txt>
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
  return (
    <View style={styles.header}>
      {parent !== undefined && (
        <Pressable onPress={onBack ?? (() => router.back())} accessibilityRole="button" accessibilityLabel={`Go to ${parent}`} hitSlop={12} style={styles.back}>
          <Txt tone="ghost" numberOfLines={1}>{`‹ ${parent} /`}</Txt>
        </Pressable>
      )}
      <Txt weight="bold" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">{title}</Txt>
      {right}
    </View>
  );
}

/** The bottom line of the list screens: how we are reaching the Toto, and who needs attention. */
export function StatusLine() {
  const router = useRouter();
  const { status, via, tally } = useConnection();
  const { bottom } = useSafeAreaInsets();
  const linked = status === 'open';
  return (
    <Pressable onPress={() => router.push('/device')} accessibilityRole="button" accessibilityLabel="Connection and device settings" style={[styles.status, { paddingBottom: bottom, minHeight: tap + bottom }]}>
      <Face mood={!linked ? 'looking' : tally.waiting ? 'waiting' : tally.working ? 'working' : 'awake'} size={12} />
      <Txt small style={{ flex: 1 }}>{linked ? (via === 'relay' ? 'relay' : 'local network') : 'reconnecting'}</Txt>
      {tally.working > 0 && <Txt small tone="signal">{tally.working} working</Txt>}
      {tally.waiting > 0 && <Txt small tone="amber" weight="bold">{tally.waiting} waiting on you</Txt>}
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

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.tube },
  pad: { paddingHorizontal: gutter },
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
  input: { flex: 1, color: color.phosphor, fontFamily: font.regular, fontSize: size.body, paddingVertical: 10 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: tap },
  form: { paddingHorizontal: gutter, paddingVertical: 12, gap: 4 },
  empty: { alignItems: 'center', gap: 20, paddingHorizontal: gutter, paddingTop: 56, paddingBottom: 32 },
  // The column a face sits in at the start of a row, so names line up down a list.
  faceCol: { width: 52 },
});
