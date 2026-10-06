import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { ConnectionProvider, useConnection } from '../connection';
import { styles } from '../styles';

function Connect() {
  const { status, notice, connect } = useConnection();
  // ponytail: typed in by hand each launch. Replaced by Bluetooth pairing and mDNS discovery in M2.
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_TOTO_URL ?? 'ws://raspberrypi.local:7860');
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_TOTO_TOKEN ?? '');
  return (
    <View style={[styles.screen, styles.centred]}>
      <Text style={styles.title}>Toto</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder="ws://raspberrypi.local:7860" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Server address" />
      <TextInput style={styles.input} value={token} onChangeText={setToken} placeholder="Token" autoCapitalize="none" autoCorrect={false} secureTextEntry accessibilityLabel="Token" />
      <Button title={status === 'connecting' ? 'Connecting…' : 'Connect'} onPress={() => connect(url, token)} disabled={status === 'connecting'} />
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
    </View>
  );
}

// Everything behind the connect screen needs a live connection, so the navigator only exists while there is one.
function Root() {
  const { status } = useConnection();
  return status === 'open' ? <Stack /> : <Connect />;
}

export default function Layout() {
  return (
    <ConnectionProvider>
      <Root />
      <StatusBar style="auto" />
    </ConnectionProvider>
  );
}
