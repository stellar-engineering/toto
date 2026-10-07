import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useConnection } from '../connection';
import { Face, type Mood } from '../face';
import { gutter } from '../theme';
import { Btn, Field, Header, Rule, Screen, Txt } from '../ui';

/** Signing this Toto's agents in to Claude: with a subscription, in two taps and a paste, or with an API key. */
export default function ClaudeScreen() {
  const { node, claude, claudeLogin, request, busy, status } = useConnection();
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const [usingKey, setUsingKey] = useState(false);
  const online = status === 'open';

  // The sign-in page opens by itself the moment its address arrives, once.
  const opened = useRef<string>(undefined);
  useEffect(() => {
    if (!claudeLogin || opened.current === claudeLogin) return;
    opened.current = claudeLogin;
    Linking.openURL(claudeLogin).catch(() => {});
  }, [claudeLogin]);

  const paste = async () => setCode((await Clipboard.getStringAsync().catch(() => '')).trim());
  const signOut = () =>
    Alert.alert('Sign out of Claude?', 'Agents on this Toto will stop being able to work until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => request({ type: 'claude_logout' }) },
    ]);

  const signedIn = claude === 'subscription' || claude === 'api_key';
  const mood: Mood = !online ? 'looking' : busy ? 'working' : signedIn ? 'awake' : claudeLogin ? 'waiting' : 'resting';

  return (
    <Screen bare>
      <Header parent={node?.name ?? 'toto'} title="claude" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: 24, gap: 16 }}>
        <Face mood={mood} size={34} nose />

        {signedIn ? (
          <>
            <Txt weight="bold">{claude === 'subscription' ? 'Signed in with your Claude subscription.' : 'Using an Anthropic API key.'}</Txt>
            <Txt tone="ghost">{claude === 'subscription' ? 'Agents on this Toto use your plan’s allowance. The sign-in lasts a year.' : 'Agents on this Toto are billed to that key by usage.'}</Txt>
            <Btn label="Sign out" kind="danger" onPress={signOut} disabled={!online || busy} />
          </>
        ) : claudeLogin ? (
          <>
            <Txt weight="bold">Approve it in your browser, then bring the code back.</Txt>
            <Txt tone="ghost">The page that opened asks you to sign in to Claude and approve. It then shows a code. Copy it and paste it here.</Txt>
            <Field label="code" value={code} onChangeText={setCode} placeholder="paste the code" />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Btn kind="primary" label={busy ? 'Signing in…' : 'Finish signing in'} onPress={() => request({ type: 'claude_code', code })} disabled={busy || !code.trim() || !online} style={{ flex: 1 }} />
              <Btn label="Paste" onPress={paste} />
            </View>
            <Btn label="Open the page again" onPress={() => Linking.openURL(claudeLogin).catch(() => {})} />
          </>
        ) : (
          <>
            <Txt weight="bold">Sign in to Claude so your agents can work.</Txt>
            <Txt tone="ghost">If you pay for Claude, this uses your plan. It takes a moment: approve in your browser, then paste a code back here.</Txt>
            <Btn kind="primary" label={busy && !usingKey ? 'Getting ready…' : 'Sign in with Claude'} onPress={() => request({ type: 'claude_login' })} disabled={busy || !online} />
          </>
        )}

        {!signedIn && (
          <>
            <Rule />
            {usingKey ? (
              <>
                <Txt tone="ghost">Paste an API key from the Anthropic console. It is checked, then kept on your Toto and nowhere else.</Txt>
                <Field label="key" value={key} onChangeText={setKey} placeholder="sk-ant-…" secureTextEntry />
                <Btn label={busy ? 'Checking it…' : 'Use this key'} onPress={() => request({ type: 'claude_key', key })} disabled={busy || !key.trim() || !online} />
              </>
            ) : (
              <Btn label="Use an API key instead" onPress={() => setUsingKey(true)} />
            )}
          </>
        )}
        {!online && <Txt tone="amber">Reconnecting to your Toto…</Txt>}
      </ScrollView>
    </Screen>
  );
}
