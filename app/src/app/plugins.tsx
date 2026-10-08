import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { progressText, useConnection, type Plugin } from '../connection';
import { gutter } from '../theme';
import { Btn, Field, Header, Rule, Screen, Txt, Waiting, styles } from '../ui';

/** What can be added to this Toto for its agents to use, and signing in to the ones that need it. */
export default function PluginsScreen() {
  const { node, plugins, progress, pluginLogin, request, busy, pending, status, owner, loaded } = useConnection();
  const online = status === 'open';
  // The plugin whose token is being pasted, and what has been pasted so far.
  const [pasting, setPasting] = useState<string>();
  const [token, setToken] = useState('');

  // The page to sign in at opens by itself the moment its address arrives, once.
  const opened = useRef<string>(undefined);
  useEffect(() => {
    if (!pluginLogin || opened.current === pluginLogin.url) return;
    opened.current = pluginLogin.url;
    Linking.openURL(pluginLogin.url).catch(() => {});
  }, [pluginLogin]);

  const doing = (type: string, name: string) => {
    const now = pending as { type: string; name?: string } | undefined;
    return now?.type === type && now.name === name;
  };
  // Installing is over when the Toto says so, not when it first says anything: it reports as it goes.
  const installing = (p: Plugin) => doing('plugin_install', p.name) || (progress?.task === `plugin:${p.name}` && !progress.failed);
  const remove = (p: Plugin) =>
    Alert.alert(`Remove ${p.name}?`, 'Agents on this Toto stop being able to use it, and any sign-in for it is forgotten.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => request({ type: 'plugin_remove', name: p.name }) },
    ]);
  const signOut = (p: Plugin) =>
    Alert.alert(`Sign out of ${p.name}?`, 'Every project on this Toto loses it until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setToken('');
          setPasting(undefined);
          request({ type: 'plugin_logout', name: p.name });
        },
      },
    ]);

  return (
    <Screen bare>
      <Header parent={node?.name ?? 'toto'} title="plugins" />
      <ScrollView contentContainerStyle={[{ paddingHorizontal: gutter, paddingVertical: 24, gap: 16 }, styles.readable]}>
        {!loaded || !plugins ? (
          <Waiting>{online ? 'Asking your Toto what it has…' : 'Reconnecting to your Toto…'}</Waiting>
        ) : (
          <>
            {!owner && <Txt tone="ghost">Only the phone that set this Toto up can change its plugins.</Txt>}
            {plugins.length === 0 && <Txt tone="ghost">There are no plugins to add yet. Your Toto looks again when it checks for updates.</Txt>}
            {plugins.map((p, i) => (
              <View key={p.name} style={{ gap: 10 }}>
                {i > 0 && <Rule />}
                <Txt weight="bold">{p.name}</Txt>
                <Txt tone="ghost" small>{p.description}</Txt>
                <Txt small tone={p.version ? 'phosphor' : 'ghost'}>
                  {p.version ? `Installed, version ${p.version}.${p.latest ? ` Version ${p.latest} is available.` : ''}` : 'Not installed.'}
                  {p.version && p.login ? (p.signedIn ? ' Signed in.' : ' Not signed in.') : ''}
                </Txt>

                {pluginLogin?.name === p.name ? (
                  <>
                    <Txt weight="bold">Enter this code on the page that opened:</Txt>
                    <Txt weight="bold" style={{ fontSize: 28, letterSpacing: 2 }} selectable>{pluginLogin.code}</Txt>
                    <Txt tone="ghost" small>Approve it there. Your Toto finishes by itself, and this changes when it has.</Txt>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Btn kind="primary" label="Copy the code" onPress={() => Clipboard.setStringAsync(pluginLogin.code).catch(() => {})} style={{ flex: 1 }} />
                      <Btn label="Open the page" onPress={() => Linking.openURL(pluginLogin.url).catch(() => {})} />
                    </View>
                  </>
                ) : pasting === p.name && p.paste && !p.signedIn ? (
                  <>
                    <Txt tone="ghost" small>{p.paste.help}</Txt>
                    <Btn label="Open the page" onPress={() => Linking.openURL(p.paste!.url).catch(() => {})} />
                    <Field label="token" value={token} onChangeText={setToken} placeholder="paste the token" secureTextEntry />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Btn kind="primary" label={doing('plugin_token', p.name) ? 'Trying it…' : 'Save token'} onPress={() => request({ type: 'plugin_token', name: p.name, token })} busy={doing('plugin_token', p.name)} disabled={busy || !token.trim() || !online} style={{ flex: 1 }} />
                      <Btn label="Paste" onPress={async () => setToken((await Clipboard.getStringAsync().catch(() => '')).trim())} />
                    </View>
                    {doing('plugin_token', p.name) && <Txt tone="ghost" small>Your Toto is checking it with {p.name}. This can take a few seconds.</Txt>}
                  </>
                ) : (
                  owner && (
                    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                      {!p.version || p.latest ? (
                        <Btn
                          kind={p.version ? 'plain' : 'primary'}
                          label={installing(p) ? (p.version ? 'Updating…' : 'Installing…') : p.version ? 'Update' : 'Install'}
                          onPress={() => request({ type: 'plugin_install', name: p.name })}
                          busy={installing(p)}
                          disabled={busy || !online}
                        />
                      ) : null}
                      {p.version && p.login && !p.signedIn && (
                        <Btn kind="primary" label={doing('plugin_login', p.name) ? 'Getting a code…' : 'Sign in'} onPress={() => (p.paste ? setPasting(p.name) : request({ type: 'plugin_login', name: p.name }))} busy={doing('plugin_login', p.name)} disabled={busy || !online} />
                      )}
                      {p.version && p.signedIn && <Btn label="Sign out" onPress={() => signOut(p)} disabled={busy || !online} />}
                      {p.version && <Btn kind="danger" label="Remove" onPress={() => remove(p)} disabled={busy || !online} />}
                    </View>
                  )
                )}
                {installing(p) && (
                  <Txt tone="ghost" small>
                    {progress?.task === `plugin:${p.name}` && !progress.failed ? progressText(progress) : 'Your Toto is fetching and checking it.'} This can take a minute or two.
                  </Txt>
                )}
              </View>
            ))}
          </>
        )}
        {loaded && !online && <Waiting tone="amber">Reconnecting to your Toto…</Waiting>}
      </ScrollView>
    </Screen>
  );
}
