import { bytesToHex } from '@noble/ciphers/utils.js';
import { getRandomValues } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useConnection } from './connection';
import { Face } from './face';
import { invitationIn } from './invite';
import { QR } from './qr';
import { openSealed, publicKey } from './secure';
import { gutter } from './theme';
import { Btn, Txt, Waiting } from './ui';

// How a browser is let in: it shows a code, a phone that owns a Toto scans it and approves, and
// the phone leaves an invitation at the relay sealed to a key only this browser holds.
const GOOD_FOR = 9 * 60_000; // a little under the relay's ten minutes
const ASK_EVERY = 2_000;

/** A new handoff: where the phone should leave the invitation, and the key to seal it to. */
const fresh = () => ({ id: bytesToHex(getRandomValues(new Uint8Array(16))), secret: getRandomValues(new Uint8Array(32)), until: Date.now() + GOOD_FOR });

/** "Chrome on Mac", near enough, for the phone to show and to list this browser under. */
function browserName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const system = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} on ${system}` : browser;
}

export function WebPair() {
  const { join } = useConnection();
  const { width } = useWindowDimensions();
  const [pair, setPair] = useState(fresh);
  const [stage, setStage] = useState<'showing' | 'joining' | 'expired'>('showing');
  const [problem, setProblem] = useState('');
  const joinNow = useRef(join);
  useEffect(() => {
    joinNow.current = join;
  });

  useEffect(() => {
    if (stage !== 'showing') return;
    let asking = true;
    const ask = async () => {
      if (Date.now() > pair.until) return setStage('expired');
      const res = await fetch(`${window.location.origin}/pair/${pair.id}`, { cache: 'no-store' }).catch(() => undefined);
      if (!asking || res?.status !== 200) return;
      asking = false;
      setStage('joining');
      let invitation;
      try {
        invitation = invitationIn(JSON.parse(openSealed(pair.secret, JSON.parse(await res.text()))));
      } catch {
        invitation = undefined;
      }
      const wrong = invitation ? await joinNow.current(invitation) : 'What the phone sent could not be read. Scan the code again.';
      // On success the app moves on to the Toto by itself; this only has a failure to report.
      if (wrong) {
        setProblem(wrong);
        setPair(fresh());
        setStage('showing');
      }
    };
    ask();
    const timer = setInterval(ask, ASK_EVERY);
    return () => {
      asking = false;
      clearInterval(timer);
    };
  }, [pair, stage]);

  const link = `toto://web?i=${pair.id}&k=${publicKey(pair.secret)}&r=${encodeURIComponent(window.location.origin)}&n=${encodeURIComponent(browserName())}`;
  return (
    <View style={{ gap: 16 }}>
      <Face mood={stage === 'joining' ? 'working' : stage === 'expired' ? 'resting' : 'waiting'} size={34} nose />
      <Txt weight="bold">Open Toto here by scanning this with your phone.</Txt>
      {stage === 'expired' ? (
        <>
          <Txt tone="ghost">That code ran out.</Txt>
          <Btn kind="primary" label="Show a new code" onPress={() => { setPair(fresh()); setProblem(''); setStage('showing'); }} />
        </>
      ) : stage === 'joining' ? (
        <Waiting hint="This browser is collecting a key of its own from your Toto, through the relay." after={4}>Your phone said yes. Joining…</Waiting>
      ) : (
        <>
          <QR value={link} size={Math.min(width - 2 * gutter, 300)} label="Code to scan with a phone that has the Toto app" />
          <Txt tone="ghost" small>Use the camera on a phone that set a Toto up. It asks you to confirm, then this browser gets a key of its own, which you can take away from that phone at any time.</Txt>
          {!!problem && <Txt tone="raspberry" accessibilityLiveRegion="polite">{problem}</Txt>}
          <Waiting hint="Nothing leaves this page but the code above. Your Toto has to be reachable through this relay." after={20}>Waiting for your phone…</Waiting>
        </>
      )}
    </View>
  );
}
