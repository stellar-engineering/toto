import { useState } from 'react';
import { View } from 'react-native';
import { DEFAULT_RELAY, useConnection } from './connection';
import { Btn, Field, Txt } from './ui';

/** The details needed to add a Toto. Used for the very first one and for every one after. */
export function NodeForm({ onAdded, onCancel }: { onAdded?: () => void; onCancel?: () => void }) {
  const { addNode } = useConnection();
  // ponytail: typed in by hand once. Replaced by Bluetooth pairing and discovery in M2.
  // The environment values only prefill the first Toto in development; a second one starts blank.
  const first = !onCancel;
  const [name, setName] = useState('');
  const [address, setAddress] = useState(first ? (process.env.EXPO_PUBLIC_TOTO_URL ?? 'ws://raspberrypi.local:7860') : '');
  const [token, setToken] = useState(first ? (process.env.EXPO_PUBLIC_TOTO_TOKEN ?? '') : '');
  const [relay, setRelay] = useState(DEFAULT_RELAY);
  const [trying, setTrying] = useState(false);
  const [problem, setProblem] = useState('');

  const add = async () => {
    setTrying(true);
    setProblem('');
    const wrong = await addNode({ name, address, token, relay });
    setTrying(false);
    if (wrong) setProblem(wrong);
    else onAdded?.();
  };

  return (
    <View>
      <Field label="name" value={name} onChangeText={setName} placeholder="optional, like Workshop" autoCapitalize="words" />
      <Field label="address" value={address} onChangeText={setAddress} placeholder="ws://raspberrypi.local:7860" keyboardType="url" />
      <Field label="token" value={token} onChangeText={setToken} placeholder="printed when Toto was installed" secureTextEntry />
      <Field label="relay" value={relay} onChangeText={setRelay} placeholder="for when you are away (optional)" keyboardType="url" />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
        <Btn kind="primary" label={trying ? 'Looking for it…' : 'Connect'} onPress={add} disabled={trying || !address.trim() || !token.trim()} style={{ flex: 1 }} />
        {onCancel && <Btn label="Cancel" onPress={onCancel} />}
      </View>
      <Txt tone="raspberry" style={{ marginTop: 16, minHeight: 44 }} accessibilityLiveRegion="polite">{problem}</Txt>
    </View>
  );
}
