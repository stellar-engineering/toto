// Push notifications, sent straight from the device through Expo's push service (which fans
// out to Google's and Apple's). Nothing about the work leaves the house: the text is fixed, the
// title is the device's name, and the only data is two random ids, so a tap can open the right
// conversation on the right device.

const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export type PushKind = 'approval' | 'done';
const TEXT: Record<PushKind, string> = {
  approval: 'An agent is waiting for your go-ahead.',
  done: 'An agent has finished.',
};

export const isPushToken = (t: unknown): t is string =>
  typeof t === 'string' && /^Expo(nent)?PushToken\[[\w-]{1,200}\]$/.test(t);

/**
 * The request body for one notification to every registered phone. `from` is the device: its
 * name heads the notification, and its relay id lets a phone that knows several devices tell
 * which one is calling.
 */
export const pushMessage = (tokens: string[], kind: PushKind, agentId: string, from: { name: string; id: string }) => ({
  to: tokens,
  title: from.name,
  body: TEXT[kind],
  data: { agentId, device: from.id },
  channelId: 'default',
  sound: 'default',
  // A waiting agent should wake the phone; a finished one can arrive when convenient.
  priority: kind === 'approval' ? 'high' : 'default',
  // One notification per agent: a newer one replaces the last instead of piling up.
  tag: agentId,
});

/** The tokens Expo's answer says are no longer registered, and so should be forgotten. */
export function deadTokens(tokens: string[], answer: any): string[] {
  const tickets: any[] = Array.isArray(answer?.data) ? answer.data : [];
  return tokens.filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered');
}

/** Sends a notification. Resolves to the tokens that should be forgotten; never rejects. */
export async function push(tokens: string[], kind: PushKind, agentId: string, from: { name: string; id: string }): Promise<string[]> {
  if (!tokens.length) return [];
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(pushMessage(tokens, kind, agentId, from)),
      signal: AbortSignal.timeout(10_000),
    });
    const answer = await res.json();
    if (!res.ok || answer?.errors) console.error(`push: ${res.status} ${JSON.stringify(answer?.errors ?? '')}`);
    return deadTokens(tokens, answer);
  } catch (err) {
    console.error(`push: ${(err as Error).message}`);
    return [];
  }
}
