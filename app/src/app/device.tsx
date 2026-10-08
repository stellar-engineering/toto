import { useEffect, useState } from 'react';
import { Alert, Keyboard, Platform, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection, type Identity, type Node, type Phone } from '../connection';
import { DEMO } from '../demo';
import { Face } from '../face';
import { inviteLink } from '../invite';
import { QR } from '../qr';
import { gutter } from '../theme';
import { Btn, Field, Header, Rule, Screen, Txt, Waiting, styles } from '../ui';

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

/** Who else has this Toto, and letting another phone in. Only the phone that set it up sees the controls. */
function Phones({ phones }: { phones: Phone[] }) {
  const { owner, invite, doneSharing, request, pending, busy, status } = useConnection();
  const { width } = useWindowDimensions();
  const [name, setName] = useState('');
  const online = status === 'open';
  const invited = invite && phones.find((p) => p.id === invite.phoneId);
  const [now, setNow] = useState(() => Date.now());
  // An invitation runs out; notice when this one has.
  useEffect(() => {
    if (!invite) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [invite]);

  const remove = (phone: Phone) =>
    Alert.alert(`Remove ${phone.name}?`, phone.pending ? 'Its invitation will stop working.' : 'It loses access straight away, and stops getting notifications. You can share with it again later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => request({ type: 'revoke', phoneId: phone.id }) },
    ]);

  if (!owner) return <Txt tone="ghost" small>This Toto was shared with this {Platform.OS === 'web' ? 'browser' : 'phone'}. The phone that set it up can take that back at any time.</Txt>;

  // The code is on screen: nothing else in this section matters until it is scanned or put away.
  if (invite && invited?.pending && invite.expires > now)
    return (
      <View style={{ gap: 14 }}>
        <Txt weight="bold">Scan this with {invited.name}’s camera.</Txt>
        <QR value={inviteLink(invite)} size={Math.min(width - 2 * gutter, 340)} label={`Invitation code for ${invited.name}`} />
        <Txt tone="ghost" small>It needs the Toto app installed. The code works once, for ten minutes, and whoever scans it gets the same access to this Toto as you. Show it only to them.</Txt>
        <Waiting hint={`Open the camera on ${invited.name} and point it at the code.`} after={0}>Waiting for it to be scanned…</Waiting>
        <Btn label="Cancel the invitation" onPress={() => { request({ type: 'revoke', phoneId: invite.phoneId }); doneSharing(); }} />
      </View>
    );

  return (
    <View style={{ gap: 4 }}>
      {invite && invited && !invited.pending && (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <Face mood="awake" size={13} />
          <Txt tone="signal" style={{ flex: 1 }} accessibilityLiveRegion="polite">{invited.name} has joined.</Txt>
        </View>
      )}
      {invite && (!invited || invited.pending) && <Txt tone="amber" style={{ marginBottom: 8 }}>That invitation ran out without being used.</Txt>}
      {phones.map((phone) => (
        <View key={phone.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
          <View style={{ flex: 1 }}>
            <Txt weight="bold" numberOfLines={1}>{phone.name}</Txt>
            <Txt tone="ghost" small>{phone.pending ? 'invited, has not joined yet' : `joined ${new Date(phone.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`}</Txt>
          </View>
          <Btn kind="danger" label="Remove" busy={pending?.type === 'revoke' && pending.phoneId === phone.id} onPress={() => remove(phone)} disabled={busy || !online} style={{ minHeight: 36, paddingHorizontal: 12 }} />
        </View>
      ))}
      <Txt tone="ghost" small style={{ marginTop: 8 }}>For a browser, open toto.royletron.dev/app on the computer and point this phone’s camera at the code it shows.</Txt>
      <Field label="whose" value={name} onChangeText={setName} placeholder="like Sam’s iPhone" autoCapitalize="words" editable={online} />
      <Btn
        kind={phones.length ? 'plain' : 'primary'}
        label={pending?.type === 'share' ? 'Making an invitation…' : 'Share with another phone'}
        busy={pending?.type === 'share'}
        onPress={() => { Keyboard.dismiss(); doneSharing(); request({ type: 'share', name }); setName(''); }}
        disabled={busy || !online || !name.trim()}
        style={{ marginTop: 12 }}
      />
    </View>
  );
}

const Section = ({ title, about, children }: { title: string; about: string; children: React.ReactNode }) => (
  <View style={[{ paddingHorizontal: gutter, paddingVertical: 20 }, styles.readable]}>
    <Txt weight="bold" accessibilityRole="header">{title}</Txt>
    <Txt tone="ghost" small style={{ marginTop: 2, marginBottom: 8 }}>{about}</Txt>
    {children}
  </View>
);

export default function Device() {
  const { status, via, node: settings, nodes, identity, sshKey, claude, plugins, software, phones, owner, request, busy, pending, loaded, trying, forget } = useConnection();
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
              settings?.address === DEMO
                ? 'A pretend Toto inside this app, for looking around. Nothing here is real, and it starts over each time. Forget it below when you have a Toto of your own.'
                : status === 'open'
                ? via === 'relay'
                  ? 'Reached through the relay, encrypted end to end.'
                  : 'Reached directly on your local network, encrypted end to end.'
                : trying.why === 'refused'
                  ? `This ${Platform.OS === 'web' ? 'browser' : 'phone'}’s access to it was taken away. Whoever shared it can share it again.`
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
          {plugins && (
            <>
              <Rule />
              <Section title="Plugins" about={plugins.some((p) => p.version) ? `${plugins.filter((p) => p.version).length} installed.` : 'Add things your agents can use, such as GitHub.'}>
                <Btn label="Plugins" onPress={() => router.push('/plugins')} />
              </Section>
            </>
          )}
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
          {phones && (
            <>
              <Section
                title="Phones"
                about={
                  !owner
                    ? 'Shared with you.'
                    : phones.length
                      ? 'This phone set this Toto up. These others can use it too, each with a key of its own that you can take away.'
                      : 'Only this phone can use this Toto. Share it to let another in, with a key of its own that you can take away.'
                }>
                <Phones phones={phones} />
              </Section>
              <Rule />
            </>
          )}
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
          <View style={[{ padding: gutter, paddingTop: 24 }, styles.readable]}>
            <Btn label="Forget this Toto" kind="danger" onPress={confirmForget} />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}
