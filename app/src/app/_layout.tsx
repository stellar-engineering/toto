import { IBMPlexMono_400Regular, IBMPlexMono_400Regular_Italic, IBMPlexMono_500Medium, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, View, type AlertButton } from 'react-native';
import { ConnectionProvider, useConnection } from '../connection';
import { Face } from '../face';
import { invitationIn } from '../invite';
import { Joining } from '../join';
import { Nearby } from '../nearby';
import { NodeForm } from '../nodeform';
import { useTapped } from '../push';
import { color, font, gutter, size } from '../theme';
import { Btn, Screen, Txt } from '../ui';
import { WebPair } from '../webpair';

// In a browser, the system dialogs the app asks its questions with do nothing at all. The
// browser's own stand in: a plain notice for one button, OK or Cancel for a choice.
// ponytail: ugly but honest. Draw them in the app's own style when the web version earns it.
if (Platform.OS === 'web') {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = message ? `${title}\n\n${message}` : title;
    const act = buttons?.find((b) => b.style !== 'cancel');
    const cancel = buttons?.find((b) => b.style === 'cancel');
    if (!buttons || buttons.length < 2) {
      window.alert(text);
      return void act?.onPress?.();
    }
    (window.confirm(text) ? act : cancel)?.onPress?.();
  };
  document.documentElement.style.backgroundColor = color.tube;
}

/** First run, or after forgetting the last Toto: tell the app where one is. */
function Setup() {
  const [trying, setTrying] = useState(false);
  const [nearby, setNearby] = useState(false);
  // In a browser the way in is a phone that already has a Toto. Typing an address is there for
  // whoever wants it, though a browser can only use one through its relay.
  const [byHand, setByHand] = useState(false);
  if (Platform.OS === 'web' && !byHand)
    return (
      <Screen bare>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: gutter, gap: 20 }}>
          <Txt weight="bold" style={{ fontSize: size.display, lineHeight: size.display * 1.1, letterSpacing: -2 }} accessibilityRole="header">
            toto<Txt tone="amber" weight="bold" style={{ fontSize: size.display }}>_</Txt>
          </Txt>
          <WebPair />
          <Btn label="Enter an address and token instead" onPress={() => setByHand(true)} />
        </View>
      </Screen>
    );
  if (nearby)
    return (
      <Screen bare>
        <Nearby onCancel={() => setNearby(false)} />
      </Screen>
    );
  return (
    <Screen bare>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: gutter }}>
        <Face mood={trying ? 'looking' : 'awake'} size={52} nose style={{ marginBottom: 28 }} />
        <Txt weight="bold" style={{ fontSize: size.display, lineHeight: size.display * 1.1, letterSpacing: -2 }} accessibilityRole="header">
          toto<Txt tone="amber" weight="bold" style={{ fontSize: size.display }}>_</Txt>
        </Txt>
        <Txt tone="ghost" style={{ marginTop: 8, marginBottom: 24 }}>Your agents keep working at home. Point this phone at the box they run on.</Txt>
        <NodeForm onTrying={setTrying} onNearby={Platform.OS === 'web' ? undefined : () => setNearby(true)} onCancel={Platform.OS === 'web' ? () => setByHand(false) : undefined} />
        <Txt tone="ghost" small>Someone sharing theirs with you? Point this phone’s camera at the code on their screen.</Txt>
      </View>
    </Screen>
  );
}

function Root() {
  const { status, nodes, switchTo } = useConnection();
  const router = useRouter();
  const ready = status !== 'setup';

  // Tapping a notification opens the conversation it was about, on the Toto it came from, once
  // there are screens to open it on.
  const tapped = useTapped();
  const opened = useRef<string>(undefined);
  useEffect(() => {
    if (!ready || !tapped || opened.current === tapped.agentId) return;
    opened.current = tapped.agentId;
    if (tapped.device && nodes.some((n) => n.id === tapped.device)) switchTo(tapped.device);
    // After this render, so the navigator that `ready` has just mounted exists.
    const timer = setTimeout(() => router.push({ pathname: '/agent/[id]', params: { id: tapped.agentId } }), 0);
    return () => clearTimeout(timer);
    // `nodes` and `switchTo` are read as they are when the tap arrives; they must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tapped?.agentId, router]);

  // An invitation scanned before this phone knows any Toto: there are no screens yet for the
  // link to open, so it is picked up here. (Once there are, it opens the join screen itself.)
  const url = Linking.useLinkingURL();
  const invitation = useMemo(() => {
    if (!url) return undefined;
    const { hostname, path, queryParams } = Linking.parse(url);
    return hostname === 'join' || path === 'join' ? { found: invitationIn(queryParams ?? {}) } : undefined;
  }, [url]);
  const [dealtWith, setDealtWith] = useState<string>();

  if (status === 'setup' && invitation && dealtWith !== url)
    return (
      <Screen bare>
        <Joining invitation={invitation.found} onDone={() => setDealtWith(url ?? undefined)} />
      </Screen>
    );
  if (status === 'setup') return <Setup />;
  // Open or reconnecting: keep every screen where it was, so a dropped connection costs nothing but a moment.
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.tube } }} />;
}

export default function Layout() {
  const [loaded, failed] = useFonts({
    [font.regular]: IBMPlexMono_400Regular,
    [font.italic]: IBMPlexMono_400Regular_Italic,
    [font.medium]: IBMPlexMono_500Medium,
    [font.bold]: IBMPlexMono_700Bold,
  });
  // A dark, empty screen for the instant the typeface takes to load, rather than a flash of the wrong one.
  if (!loaded && !failed) return <View style={{ flex: 1, backgroundColor: color.tube }} />;
  return (
    <ConnectionProvider>
      <Root />
      <StatusBar style="light" />
    </ConnectionProvider>
  );
}
