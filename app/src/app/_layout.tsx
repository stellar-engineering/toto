import { IBMPlexMono_400Regular, IBMPlexMono_400Regular_Italic, IBMPlexMono_500Medium, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { ConnectionProvider, useConnection } from '../connection';
import { NodeForm } from '../nodeform';
import { useTapped } from '../push';
import { color, font, gutter, size } from '../theme';
import { Screen, Txt } from '../ui';

/** First run, or after forgetting the last Toto: tell the app where one is. */
function Setup() {
  return (
    <Screen bare>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: gutter }}>
        <Txt weight="bold" style={{ fontSize: size.display, lineHeight: size.display * 1.1, letterSpacing: -2 }} accessibilityRole="header">
          toto<Txt tone="amber" weight="bold" style={{ fontSize: size.display }}>_</Txt>
        </Txt>
        <Txt tone="ghost" style={{ marginTop: 8, marginBottom: 24 }}>Your agents keep working at home. Point this phone at the box they run on.</Txt>
        <NodeForm />
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
