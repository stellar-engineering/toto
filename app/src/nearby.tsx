import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { bluetooth, look, openSetup, type Found, type Setup, type WifiNetwork } from './ble';
import { useConnection } from './connection';
import { Face, type Mood } from './face';
import { keysFromToken } from './secure';
import { gutter } from './theme';
import { Btn, Field, Txt, styles } from './ui';

type Step =
  | { at: 'starting' }
  | { at: 'cannot'; why: string }
  | { at: 'looking'; found: Found[] }
  | { at: 'meeting' }
  | { at: 'met'; setup: Setup; wifi: string | null }
  | { at: 'networks'; setup: Setup; list: WifiNetwork[] | null; chosen?: WifiNetwork }
  | { at: 'joining'; setup: Setup; ssid: string }
  | { at: 'adding'; setup: Setup }
  | { at: 'failed'; why: string };

const CANNOT = {
  unsupported: 'Setting up over Bluetooth needs the installed Toto app. This build does not have it.',
  denied: 'Toto needs permission to use Bluetooth to find a device nearby. You can allow it in your phone’s settings.',
  off: 'Bluetooth is switched off. Turn it on and try again.',
};

/** Finds a Toto nearby over Bluetooth, gets it onto Wi-Fi if it is not, and adds it. */
export function Nearby({ onAdded, onCancel }: { onAdded?: () => void; onCancel: () => void }) {
  const { nodes, addNode } = useConnection();
  const [step, setStep] = useState<Step>({ at: 'starting' });
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  // Whatever conversation is open when this goes away gets hung up.
  const open = useRef<Setup | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      open.current?.close();
    };
  }, []);
  const go = (next: Step) => alive.current && setStep(next);

  // Look for as long as we are on the looking step.
  const looking = step.at === 'looking';
  useEffect(() => {
    if (step.at === 'starting') {
      bluetooth().then((state) => go(state === 'ready' ? { at: 'looking', found: [] } : { at: 'cannot', why: CANNOT[state] }));
      return;
    }
    if (!looking) return;
    return look((toto) =>
      setStep((now) => (now.at !== 'looking' || now.found.some((f) => f.id === toto.id) ? now : { at: 'looking', found: [...now.found, toto] })),
    );
    // `go` only guards against updating after leaving; it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.at === 'starting', looking]);

  const meet = async (toto: Found) => {
    go({ at: 'meeting' });
    try {
      // A Toto that already has an owner will only talk to a phone that holds its token.
      const setup = await openSetup(toto.id, (id) => {
        const ours = nodes.find((n) => n.id === id);
        return ours && keysFromToken(ours.token).psk;
      });
      open.current = setup;
      go({ at: 'met', setup, wifi: setup.info.wifi });
    } catch (err) {
      go({ at: 'failed', why: String((err as Error).message ?? err) });
    }
  };

  const listNetworks = async (setup: Setup) => {
    setProblem('');
    setPassword('');
    go({ at: 'networks', setup, list: null });
    try {
      // Where this phone is set to be, for a new Pi that will not use its Wi-Fi until it is told.
      const country = /[-_]([A-Z]{2})\b/.exec(Intl.DateTimeFormat().resolvedOptions().locale)?.[1];
      const reply = await setup.ask({ type: 'networks', country });
      if (reply.type !== 'networks') throw new Error(reply.type === 'refused' ? reply.problem : 'It could not list networks.');
      go({ at: 'networks', setup, list: reply.list });
    } catch (err) {
      go({ at: 'failed', why: String((err as Error).message ?? err) });
    }
  };

  const join = async (setup: Setup, network: WifiNetwork) => {
    go({ at: 'joining', setup, ssid: network.ssid });
    try {
      const reply = await setup.ask({ type: 'join', ssid: network.ssid, password });
      if (reply.type === 'joined' && reply.ok) return go({ at: 'met', setup, wifi: network.ssid });
      setProblem(reply.type === 'joined' ? (reply.problem ?? 'It could not join that network.') : 'It could not join that network.');
      go({ at: 'networks', setup, list: null, chosen: network });
      listNetworks(setup).then(() => alive.current && setStep((now) => (now.at === 'networks' ? { ...now, chosen: network } : now)));
    } catch (err) {
      go({ at: 'failed', why: String((err as Error).message ?? err) });
    }
  };

  const add = async (setup: Setup) => {
    go({ at: 'adding', setup });
    try {
      const reply = await setup.ask({ type: 'claim' });
      if (reply.type !== 'claimed') throw new Error(reply.type === 'refused' ? reply.problem : 'It would not hand over its keys.');
      // The phone has to be able to reach it over the network now, not just over Bluetooth.
      const wrong = await addNode({ address: reply.address, token: reply.token, relay: reply.relay });
      if (wrong) throw new Error(`${reply.name} is set up, but this phone could not reach it on the network. Are they on the same Wi-Fi? (${wrong})`);
      setup.close();
      open.current = undefined;
      onAdded?.();
    } catch (err) {
      go({ at: 'failed', why: String((err as Error).message ?? err) });
    }
  };

  const mood: Mood =
    step.at === 'looking' || step.at === 'starting' || step.at === 'meeting' ? 'looking'
    : step.at === 'joining' || step.at === 'adding' ? 'working'
    : step.at === 'failed' || step.at === 'cannot' ? 'failed'
    : 'awake';
  const retry = () => {
    open.current?.close();
    open.current = undefined;
    setProblem('');
    go({ at: 'starting' });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: 24, gap: 16 }}>
      <Face mood={mood} size={34} nose />

      {step.at === 'starting' && <Txt tone="ghost">Checking Bluetooth…</Txt>}
      {step.at === 'cannot' && <Txt>{step.why}</Txt>}

      {step.at === 'looking' && (
        <>
          <Txt>{step.found.length ? 'Found nearby. Tap the one to set up.' : 'Looking for a Toto nearby. Plug it in and wait a minute for it to start.'}</Txt>
          {step.found.map((toto, i) => (
            <Pressable key={toto.id} onPress={() => meet(toto)} style={[styles.row, { paddingHorizontal: 0 }]} accessibilityRole="button">
              <Txt weight="bold">{step.found.length > 1 ? `Toto ${i + 1}` : 'A Toto'}</Txt>
              <Txt tone="ghost" small>{toto.signal > -60 ? 'very close' : toto.signal > -80 ? 'nearby' : 'at the edge of range'}</Txt>
            </Pressable>
          ))}
        </>
      )}

      {step.at === 'meeting' && <Txt tone="ghost">Connecting to it…</Txt>}

      {step.at === 'met' && (
        <>
          <Txt weight="bold">{step.setup.info.name}</Txt>
          <Txt>{step.wifi ? `It is on the Wi-Fi network ${step.wifi}. Your phone needs to be on the same one to add it.` : 'It is not on Wi-Fi yet. Pick a network for it to join.'}</Txt>
          {step.wifi ? <Btn kind="primary" label="Add this Toto" onPress={() => add(step.setup)} /> : <Btn kind="primary" label="Choose a network" onPress={() => listNetworks(step.setup)} />}
          {!!step.wifi && <Btn label="Put it on a different network" onPress={() => listNetworks(step.setup)} />}
        </>
      )}

      {step.at === 'networks' && (
        <>
          <Txt>{step.chosen ? `Password for ${step.chosen.ssid}` : 'Which network should it join?'}</Txt>
          {!!problem && <Txt tone="raspberry" accessibilityLiveRegion="polite">{problem}</Txt>}
          {step.chosen ? (
            <>
              {step.chosen.secure && <Field label="password" value={password} onChangeText={setPassword} secureTextEntry autoFocus placeholder="the network's password" />}
              <Btn kind="primary" label="Join" onPress={() => join(step.setup, step.chosen!)} disabled={step.chosen.secure && password.length < 8} />
              <Btn label="Pick another" onPress={() => { setProblem(''); setStep({ ...step, chosen: undefined }); }} />
            </>
          ) : step.list === null ? (
            <Txt tone="ghost">It is looking for networks…</Txt>
          ) : (
            step.list.map((network) => (
              <Pressable key={network.ssid} onPress={() => { setProblem(''); setPassword(''); setStep({ ...step, chosen: network }); }} style={[styles.row, { paddingHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }]} accessibilityRole="button">
                <Txt weight="bold" numberOfLines={1} style={{ flex: 1 }}>{network.ssid}</Txt>
                <Txt tone="ghost" small>{network.secure ? 'locked' : 'open'}  {network.signal}%</Txt>
              </Pressable>
            ))
          )}
        </>
      )}

      {step.at === 'joining' && <Txt tone="ghost">It is joining {step.ssid}. This can take up to a minute.</Txt>}
      {step.at === 'adding' && <Txt tone="ghost">Adding it…</Txt>}
      {step.at === 'failed' && <Txt tone="raspberry">{step.why}</Txt>}

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        {(step.at === 'failed' || step.at === 'cannot') && <Btn label="Try again" onPress={retry} style={{ flex: 1 }} />}
        <Btn label="Cancel" onPress={onCancel} style={{ flex: step.at === 'failed' || step.at === 'cannot' ? undefined : 1 }} />
      </View>
    </ScrollView>
  );
}
