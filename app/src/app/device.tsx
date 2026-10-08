import { useState } from 'react';
import { Alert, Keyboard, ScrollView, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection, type Identity, type Node } from '../connection';
import { Face } from '../face';
import { gutter } from '../theme';
import { Btn, Field, Header, Rule, Screen, Txt, Waiting } from '../ui';

function Author({ identity }: { identity: Identity }) {
  const { request, busy, pending } = useConnection();
  const [name, setName] = useState(identity.name);
  const [email, setEmail] = useState(identity.email);
  const changed = name.trim() !== identity.name || email.trim() !== identity.email;
  return (
    <>
      <Field label="name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      <Field label="email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
      {changed && <Btn kind="primary" label={pending?.type === 'set_identity' ? 'Saving…' : 'Save author'} onPress={() => request({ type: 'set_identity', name, email })} busy={pending?.type === 'set_identity'} disabled={busy || !name.trim() || !email.trim()} style={{ marginTop: 12 }} />}
    </>
  );
}

function Where({ settings }: { settings: Node }) {
  const { relocate, request, busy, pending, status } = useConnection();
  const [name, setName] = useState(settings.name);
  const [address, setAddress] = useState(settings.address);
  const [relay, setRelay] = useState(settings.relay);
  const renamed = name.trim() !== settings.name;
  const changed = address.trim() !== settings.address || relay.trim() !== settings.relay;
  return (
    <>
      {/* The name belongs to the device, so changing it needs the device, and shows on every phone. */}
      <Field label="name" value={name} onChangeText={setName} placeholder="what to call it" autoCapitalize="words" editable={status === 'open'} />
      {renamed && <Btn kind="primary" label={pending?.type === 'rename_device' ? 'Renaming…' : 'Rename'} busy={pending?.type === 'rename_device'} onPress={() => { Keyboard.dismiss(); request({ type: 'rename_device', name }); }} disabled={busy || !name.trim() || status !== 'open'} style={{ marginVertical: 12 }} />}
      <Field label="address" value={address} onChangeText={setAddress} placeholder="ws://raspberrypi.local:7860" keyboardType="url" />
      <Field label="relay" value={relay} onChangeText={setRelay} placeholder="none: local network only" keyboardType="url" />
      {changed && <Btn kind="primary" label="Save and reconnect" onPress={() => relocate({ address, relay })} disabled={!address.trim()} style={{ marginTop: 12 }} />}
    </>
  );
}

const Section = ({ title, about, children }: { title: string; about: string; children: React.ReactNode }) => (
  <View style={{ paddingHorizontal: gutter, paddingVertical: 20 }}>
    <Txt weight="bold" accessibilityRole="header">{title}</Txt>
    <Txt tone="ghost" small style={{ marginTop: 2, marginBottom: 8 }}>{about}</Txt>
    {children}
  </View>
);

export default function Device() {
  const { status, via, node: settings, nodes, identity, sshKey, claude, software, request, busy, pending, loaded, trying, forget } = useConnection();
  const router = useRouter();

  const confirmForget = () =>
    Alert.alert('Forget this Toto?', 'This phone will stop connecting to it. Nothing on the Toto changes, and you can connect again with its address and token.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          // With others left, land on the next one's projects; with none, setup takes over.
          if (nodes.length > 1) router.back();
          forget();
        },
      },
    ]);

  const update = () =>
    Alert.alert(`Update to ${software?.latest}?`, 'Your Toto downloads the release, checks it is genuine, installs it and restarts. If the new version will not start, it puts the old one back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Update', onPress: () => request({ type: 'update' }) },
    ]);

  return (
    <Screen bare>
      <Header parent={settings?.name ?? 'toto'} title="settings" />
      <View style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: gutter, paddingTop: 24 }}>
            <Face mood={status === 'open' ? 'awake' : 'looking'} size={30} nose />
          </View>
          <Section
            title={settings?.name ?? ''}
            about={
              status === 'open'
                ? via === 'relay'
                  ? 'Reached through the relay, encrypted end to end.'
                  : 'Reached directly on your local network, encrypted end to end.'
                : trying.phase === 'local'
                  ? 'Looking for it on this network…'
                  : trying.phase === 'relay'
                    ? 'Not on this network. Trying the relay…'
                    : trying.why === 'offline'
                      ? 'It is not connected to the relay: switched off, or without internet. Trying again every few seconds.'
                      : settings?.relay
                        ? 'It did not answer on this network or through the relay. Trying again every few seconds.'
                        : 'It did not answer. No relay is set, so this only works on the same network as your Toto.'
            }>
            {/* Keyed on the saved value, so the fields follow it after a save. */}
            {settings && <Where key={`${settings.id}\n${settings.name}\n${settings.address}\n${settings.relay}`} settings={settings} />}
          </Section>
          <Rule />
          {!loaded ? (
            // Everything below is the Toto's to say, and it has not yet.
            <View style={{ paddingHorizontal: gutter, paddingVertical: 24 }}>
              <Waiting>{status === 'open' ? 'Fetching this Toto’s settings…' : 'Its settings will show once it is reached.'}</Waiting>
            </View>
          ) : (
          <>
          <Section
            title="Claude"
            about={claude === 'subscription' ? 'Signed in with your Claude subscription.' : claude === 'api_key' ? 'Using an Anthropic API key.' : 'Not signed in. Agents cannot work until it is.'}>
            <Btn kind={claude === 'none' ? 'primary' : 'plain'} label={claude === 'none' ? 'Sign in to Claude' : 'Change'} onPress={() => router.push('/claude')} />
          </Section>
          <Rule />
          {software ? (
            <Section
              title="Software"
              about={
                software.updating
                  ? 'Updating. Your Toto restarts when it is done, which takes a few minutes.'
                  : software.latest
                    ? `Version ${software.version}. Version ${software.latest} is available.`
                    : `Version ${software.version}. Up to date.`
              }>
              {software.latest ? (
                <Btn kind="primary" label={software.updating ? 'Updating…' : pending?.type === 'update' ? 'Downloading and checking…' : `Update to ${software.latest}`} onPress={update} busy={software.updating || pending?.type === 'update'} disabled={busy || status !== 'open'} />
              ) : (
                <Btn label={pending?.type === 'check_update' ? 'Checking…' : 'Check for updates'} onPress={() => request({ type: 'check_update' })} busy={pending?.type === 'check_update'} disabled={software.updating || busy || status !== 'open'} />
              )}
            </Section>
          ) : (
            <Section title="Software" about="This Toto is too old to update itself. Flash it with a newer image, or run the installer again.">
              {null}
            </Section>
          )}
          <Rule />
          {identity && (
            <Section title="Commit author" about="Agents make their git commits under this name and email.">
              {/* Keyed on the saved value so the fields follow it, including when another device changes it. */}
              <Author key={`${identity.name}\n${identity.email}`} identity={identity} />
            </Section>
          )}
          {!!sshKey && (
            <>
              <Rule />
              <Section title="SSH key" about="Add this to your git host so Toto can clone and push. On GitHub: Settings, then SSH and GPG keys.">
                <Txt small selectable>{sshKey}</Txt>
                <Btn label="Share key" onPress={() => Share.share({ message: sshKey })} style={{ marginTop: 12 }} />
              </Section>
            </>
          )}
          </>
          )}
          <Rule />
          <View style={{ padding: gutter, paddingTop: 24 }}>
            <Btn label="Forget this Toto" kind="danger" onPress={confirmForget} />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}
