import { getRandomValues } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useConnection } from '../connection';
import { Face } from '../face';
import { sealTo } from '../secure';
import { gutter } from '../theme';
import { Btn, Header, Screen, Txt, Waiting } from '../ui';

/** What a browser's code asks for, checked for shape: it came from a camera pointed at who knows what. */
function askIn(params: Record<string, unknown>) {
  const { i, k, r, n } = params;
  if (typeof i !== 'string' || typeof k !== 'string' || typeof r !== 'string') return undefined;
  if (!/^[0-9a-f]{32}$/.test(i) || !/^[0-9a-f]{64}$/.test(k) || !/^https?:\/\/[^\s/]+$/.test(r)) return undefined;
  return { id: i, key: k, relay: r, name: typeof n === 'string' && n.trim() ? n.trim().slice(0, 40) : 'A browser' };
}

/** Where a browser's code lands on the phone: say who is asking, and hand over an invitation if the owner agrees. */
export default function WebAccess() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const { node, status, owner, phones, invite, doneSharing, request, post } = useConnection();
  const ask = useMemo(() => askIn(params), [params]);
  const [stage, setStage] = useState<'asking' | 'making' | 'sent' | 'failed'>('asking');
  const host = ask?.relay.replace(/^https?:\/\//, '');
  const theirs = stage !== 'asking' && invite ? phones?.find((p) => p.id === invite.phoneId) : undefined;

  // The Toto has made the invitation. Seal it to the browser's key and leave it where the browser is looking.
  useEffect(() => {
    if (stage !== 'making' || !invite || !ask) return;
    const { type, expires, ...invitation } = invite;
    const sealed = sealTo(ask.key, JSON.stringify({ a: invitation.address, r: invitation.relay, d: invitation.deviceId, k: invitation.relayKey, i: invitation.phoneId, s: invitation.secret, n: invitation.name }), (n) => getRandomValues(new Uint8Array(n)));
    fetch(`${ask.relay}/pair/${ask.id}`, { method: 'PUT', body: JSON.stringify(sealed) })
      .then((res) => {
        if (!res.ok) throw new Error();
        setStage('sent');
      })
      .catch(() => {
        // Nobody can use an invitation that was never delivered; take it back.
        post({ type: 'revoke', phoneId: invite.phoneId });
        setStage('failed');
      });
    // `post` is new each render; this runs once per invitation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, invite, ask]);

  const done = () => {
    doneSharing();
    router.replace('/');
  };
  const cannot = !ask
    ? 'That code is not from Toto in a browser, or part of it is missing.'
    : !node
      ? 'This phone has no Toto to share yet.'
      : status !== 'open'
        ? `${node.name} cannot be reached right now, so it cannot be shared.`
        : !phones
          ? `${node.name} needs updating before it can be shared. Update it in settings, under Software.`
          : !owner
            ? `${node.name} was shared with this phone. Only the phone that set it up can share it.`
            : '';

  return (
    <Screen bare>
      <Header title="browser" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: 24, gap: 16 }}>
        <Face mood={stage === 'failed' || cannot ? 'failed' : stage === 'sent' && theirs && !theirs.pending ? 'awake' : stage === 'asking' ? 'waiting' : 'working'} size={34} nose />
        {cannot ? (
          <>
            <Txt>{cannot}</Txt>
            <Btn label="OK" onPress={done} />
          </>
        ) : stage === 'asking' ? (
          <>
            <Txt weight="bold">Let this browser use {node!.name}?</Txt>
            <Txt>{ask!.name}, on a page at {host}.</Txt>
            <Txt tone="amber">Only say yes if that page is open in front of you right now, on a computer you trust. Someone who got you to scan their code would get into your Toto.</Txt>
            <Txt tone="ghost" small>The browser gets the same access to {node!.name} as this phone, with a key of its own. You can take it away under Phones in settings.</Txt>
            <Btn kind="primary" label="Give it access" onPress={() => { doneSharing(); setStage('making'); request({ type: 'share', name: ask!.name }); }} />
            <Btn label="Cancel" onPress={done} />
          </>
        ) : stage === 'making' ? (
          <Waiting>Making it an invitation…</Waiting>
        ) : stage === 'failed' ? (
          <>
            <Txt tone="raspberry">The invitation could not be left for the browser. Check this phone is online, then scan the code again.</Txt>
            <Btn label="OK" onPress={done} />
          </>
        ) : theirs && !theirs.pending ? (
          <>
            <Txt weight="bold" tone="signal">{theirs.name} is in.</Txt>
            <Txt tone="ghost" small>It is listed under Phones in settings, where you can remove it.</Txt>
            <Btn kind="primary" label="Done" onPress={done} />
          </>
        ) : (
          <>
            <Waiting hint="The browser should open your Toto within a few seconds." after={0}>Sent. Waiting for the browser to collect it…</Waiting>
            <Btn label="Done" onPress={done} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
