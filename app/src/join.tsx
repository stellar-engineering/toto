import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useConnection, type Invitation } from './connection';
import { Face } from './face';
import { gutter } from './theme';
import { Btn, Txt, Waiting, styles } from './ui';

/** Uses an invitation, saying what is happening and what went wrong if it does. */
export function Joining({ invitation, onDone }: { invitation: Invitation | undefined; onDone: () => void }) {
  const { join, nodes } = useConnection();
  const [problem, setProblem] = useState(invitation ? '' : 'That code is not a Toto invitation, or part of it is missing.');
  // Once per invitation: it only works once, and this screen can be drawn more than once.
  const used = useRef(false);
  const already = !!invitation && nodes.some((n) => n.id === invitation.deviceId);
  useEffect(() => {
    if (!invitation || used.current) return;
    used.current = true;
    // Already here: this is the same link arriving again after it worked.
    if (already) return onDone();
    join(invitation).then((wrong) => (wrong ? setProblem(wrong) : onDone()));
    // `join` and `onDone` are new each render; the invitation is what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitation]);

  return (
    <View style={[{ paddingHorizontal: gutter, paddingVertical: 24, gap: 16 }, styles.readable]}>
      <Face mood={problem ? 'failed' : 'looking'} size={34} nose />
      {problem ? (
        <>
          <Txt weight="bold">That did not work.</Txt>
          <Txt tone="raspberry" accessibilityLiveRegion="polite">{problem}</Txt>
          <Btn label="OK" onPress={onDone} />
        </>
      ) : (
        <Waiting hint="It is looked for on this network first, then through the relay." after={5}>{`Joining ${invitation?.name ?? ''}…`}</Waiting>
      )}
    </View>
  );
}
