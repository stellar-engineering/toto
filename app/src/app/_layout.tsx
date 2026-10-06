import { IBMPlexMono_400Regular, IBMPlexMono_400Regular_Italic, IBMPlexMono_500Medium, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';
import { ConnectionProvider, useConnection } from '../connection';
import { color, font, gutter, size } from '../theme';
import { Btn, Field, Screen, Txt } from '../ui';

/** First run, or after forgetting a Toto: tell the app where one is. */
function Setup() {
  const { status, notice, connect } = useConnection();
  // ponytail: typed in by hand once. Replaced by Bluetooth pairing and discovery in M2.
  const [address, setAddress] = useState(process.env.EXPO_PUBLIC_TOTO_URL ?? 'ws://raspberrypi.local:7860');
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_TOTO_TOKEN ?? '');
  const [relay, setRelay] = useState(process.env.EXPO_PUBLIC_TOTO_RELAY ?? 'wss://toto.royletron.dev');
  const connecting = status === 'connecting';
  return (
    <Screen bare>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: gutter }}>
        <Txt weight="bold" style={{ fontSize: size.display, lineHeight: size.display * 1.1, letterSpacing: -2 }} accessibilityRole="header">
          toto<Txt tone="amber" weight="bold" style={{ fontSize: size.display }}>_</Txt>
        </Txt>
        <Txt tone="ghost" style={{ marginTop: 8, marginBottom: 24 }}>Your agents keep working at home. Point this phone at the box they run on.</Txt>
        <Field label="address" value={address} onChangeText={setAddress} placeholder="ws://raspberrypi.local:7860" keyboardType="url" />
        <Field label="token" value={token} onChangeText={setToken} placeholder="printed when Toto was installed" secureTextEntry />
        <Field label="relay" value={relay} onChangeText={setRelay} placeholder="for when you are away (optional)" keyboardType="url" />
        <Btn kind="primary" label={connecting ? 'Connecting…' : 'Connect'} onPress={() => connect({ address, token, relay })} disabled={connecting || !address.trim() || !token.trim()} style={{ marginTop: 24 }} />
        <Txt tone="raspberry" style={{ marginTop: 16, minHeight: 44 }} accessibilityLiveRegion="polite">{notice}</Txt>
      </View>
    </Screen>
  );
}

function Root() {
  const { status } = useConnection();
  if (status === 'setup' || status === 'connecting') return <Setup />;
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
