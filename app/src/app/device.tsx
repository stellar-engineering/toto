import { useState } from 'react';
import { Alert, ScrollView, Share, View } from 'react-native';
import { useConnection, type Identity, type Settings } from '../connection';
import { gutter } from '../theme';
import { Btn, Field, Header, Rule, Screen, Txt } from '../ui';

function Author({ identity }: { identity: Identity }) {
  const { request, busy } = useConnection();
  const [name, setName] = useState(identity.name);
  const [email, setEmail] = useState(identity.email);
  const changed = name.trim() !== identity.name || email.trim() !== identity.email;
  return (
    <>
      <Field label="name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      <Field label="email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
      {changed && <Btn kind="primary" label="Save author" onPress={() => request({ type: 'set_identity', name, email })} disabled={busy || !name.trim() || !email.trim()} style={{ marginTop: 12 }} />}
    </>
  );
}

function Where({ settings }: { settings: Settings }) {
  const { relocate } = useConnection();
  const [address, setAddress] = useState(settings.address);
  const [relay, setRelay] = useState(settings.relay);
  const changed = address.trim() !== settings.address || relay.trim() !== settings.relay;
  return (
    <>
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
  const { status, via, settings, identity, sshKey, forget } = useConnection();
  const host = settings?.address.replace(/^wss?:\/\//, '').replace(/:\d+$/, '') ?? '';

  const confirmForget = () =>
    Alert.alert('Forget this Toto?', 'This phone will stop connecting to it. Nothing on the Toto changes, and you can connect again with its address and token.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: forget },
    ]);

  return (
    <Screen bare>
      <Header parent="toto" title="device" />
      <View style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Section
            title={host}
            about={
              status === 'open'
                ? via === 'relay'
                  ? 'Reached through the relay, encrypted end to end.'
                  : 'Reached directly on your local network, encrypted end to end.'
                : settings?.relay
                  ? 'Not reachable right now. Trying the local network, then the relay, every few seconds.'
                  : 'Not reachable right now. No relay is set, so this only works on the same network as your Toto.'
            }>
            {/* Keyed on the saved value, so the fields follow it after a save. */}
            {settings && <Where key={`${settings.address}\n${settings.relay}`} settings={settings} />}
          </Section>
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
          <Rule />
          <View style={{ padding: gutter, paddingTop: 24 }}>
            <Btn label="Forget this Toto" kind="danger" onPress={confirmForget} />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}
