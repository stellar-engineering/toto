import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { invitationIn } from '../invite';
import { Joining } from '../join';
import { Header, Screen } from '../ui';

/** Where a scanned invitation lands when the app already knows a Toto. */
export default function JoinScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const invitation = useMemo(() => invitationIn(params), [params]);
  return (
    <Screen bare>
      <Header title="join" />
      <Joining invitation={invitation} onDone={() => router.replace('/')} />
    </Screen>
  );
}
