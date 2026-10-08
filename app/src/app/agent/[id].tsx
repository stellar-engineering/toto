import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useConnection, type AgentEvent } from '../../connection';
import { Markdown } from '../../markdown';
import { Terminal } from '../../terminal';
import { color, gutter, tap } from '../../theme';
import { Face } from '../../face';
import { Btn, Empty, Header, Loading, Reaching, Screen, Spinner, Txt, Waiting, styles as ui } from '../../ui';

const NO_EVENTS: AgentEvent[] = [];

type Row =
  | { kind: 'user' | 'text' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: { output: string; isError: boolean }; decision?: 'waiting' | boolean };

/** Folds the event stream into what is shown: each tool call carries its own result and approval. */
function toRows(events: AgentEvent[]): Row[] {
  const rows: Row[] = [];
  const tools = new Map<string, Extract<Row, { kind: 'tool' }>>();
  const tool = (id: string, name: string, input: unknown) => {
    let row = tools.get(id);
    if (!row) {
      row = { kind: 'tool', id, name, input };
      tools.set(id, row);
      rows.push(row);
    }
    return row;
  };
  for (const e of events) {
    if (e.type === 'user' || e.type === 'text') rows.push({ kind: e.type, text: e.text });
    else if (e.type === 'tool_call') tool(e.id, e.name, e.input);
    else if (e.type === 'approval_request') tool(e.id, e.name, e.input).decision = 'waiting';
    else if (e.type === 'approval_resolved') {
      const row = tools.get(e.id);
      if (row) row.decision = e.allowed;
    } else if (e.type === 'tool_result') {
      const row = tools.get(e.id);
      if (row) row.result = { output: e.output, isError: e.isError };
    } else if (e.type === 'error') rows.push({ kind: 'error', text: e.message });
    else if (e.type === 'done' && e.isError) rows.push({ kind: 'error', text: 'Stopped on an error.' });
  }
  return rows;
}

/** The one argument that says what a tool call is about. */
function brief(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === 'string') return i.file_path.split('/').slice(-2).join('/');
  const value = i.command ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
  return typeof value === 'string' ? value : '';
}

type Question = { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean };

/** The questions in an AskUserQuestion call, if the input looks like one. */
function questionsIn(input: unknown): Question[] {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.filter((q): q is Question => typeof q?.question === 'string' && Array.isArray(q.options));
}

/** Claude asking you something, with its options to tap. Answers go back keyed by the question's text. */
function Questions({ name, questions, online, onDecide }: { name: string; questions: Question[]; online: boolean; onDecide: (allow: boolean, answers?: Record<string, string>) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const toggle = (q: Question, label: string) =>
    setPicked((p) => {
      const have = p[q.question] ?? [];
      const next = q.multiSelect ? (have.includes(label) ? have.filter((l) => l !== label) : [...have, label]) : [label];
      return { ...p, [q.question]: next };
    });
  // Typing your own answer replaces the options for a single choice, and joins them for several.
  const answerTo = (q: Question) => {
    const typed = other[q.question]?.trim();
    const chosen = q.multiSelect || !typed ? (picked[q.question] ?? []) : [];
    return [...chosen, ...(typed ? [typed] : [])].join(', ');
  };
  const done = questions.every((q) => answerTo(q));
  const submit = () => onDecide(true, Object.fromEntries(questions.map((q) => [q.question, answerTo(q)])));

  return (
    <View style={local.ask} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Face mood="waiting" size={15} ink={color.tube} />
        <Txt tone="tube" weight="bold" style={{ flex: 1 }}>{questions.length > 1 ? 'Claude has some questions' : 'Claude has a question'}</Txt>
      </View>
      {questions.map((q) => (
        <View key={q.question} style={{ marginTop: 14, gap: 8 }}>
          {!!q.header && <Txt tone="tube" small>{q.header.toUpperCase()}</Txt>}
          <Txt tone="tube" weight="bold">{q.question}</Txt>
          {q.options.map((o) => {
            const on = (picked[q.question] ?? []).includes(o.label) && (q.multiSelect || !other[q.question]?.trim());
            return (
              <Pressable key={o.label} onPress={() => toggle(q, o.label)} accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} accessibilityLabel={o.label} style={({ pressed }) => [local.option, on && { backgroundColor: color.tube }, pressed && { opacity: 0.7 }]}>
                <Txt tone={on ? 'amber' : 'tube'} weight="bold">{(q.multiSelect ? (on ? '[x] ' : '[ ] ') : on ? '(•) ' : '( ) ') + o.label}</Txt>
                {!!o.description && <Txt tone={on ? 'amber' : 'tube'} small style={{ paddingLeft: 28 }}>{o.description}</Txt>}
              </Pressable>
            );
          })}
          <TextInput
            style={[ui.input, { color: color.tube, borderColor: color.tube }]}
            value={other[q.question] ?? ''}
            onChangeText={(t) => setOther((o) => ({ ...o, [q.question]: t }))}
            placeholder="Something else"
            placeholderTextColor={color.tube}
            selectionColor={color.tube}
            keyboardAppearance="dark"
            accessibilityLabel={`Your own answer to: ${q.question}`}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
        <Pressable onPress={submit} disabled={!done || !online} accessibilityRole="button" accessibilityLabel="Send answers" style={({ pressed }) => [local.askBtn, { backgroundColor: color.tube, flex: 1 }, (!done || !online) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
          <Txt tone="amber" weight="bold">Answer</Txt>
        </Pressable>
        <Pressable onPress={() => onDecide(false)} disabled={!online} accessibilityRole="button" accessibilityLabel={`Skip ${name}`} style={({ pressed }) => [local.askBtn, { borderWidth: 1.5, borderColor: color.tube }, !online && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
          <Txt tone="tube" weight="bold">Skip</Txt>
        </Pressable>
      </View>
      {!online && <Txt tone="tube" small style={{ marginTop: 10 }}>Reconnecting. You can answer in a moment.</Txt>}
    </View>
  );
}

function ToolRow({ row, online, deciding, onDecide }: { row: Extract<Row, { kind: 'tool' }>; online: boolean; /** An answer has been sent and the agent has not yet said it heard. */ deciding: boolean; onDecide: (allow: boolean, answers?: Record<string, string>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const what = brief(row.input);

  // The moment the whole app exists for: an agent has stopped and is waiting on you.
  const questions = row.name === 'AskUserQuestion' ? questionsIn(row.input) : [];
  if (row.decision === 'waiting' && deciding)
    return (
      <View style={local.ask} accessibilityLiveRegion="polite">
        <Waiting tone="tube" hint="Still not heard back. If this stays, the agent may have stopped." after={10}>Telling the agent…</Waiting>
      </View>
    );
  if (row.decision === 'waiting' && questions.length) return <Questions name={row.name} questions={questions} online={online} onDecide={onDecide} />;
  if (row.decision === 'waiting')
    return (
      <View style={local.ask} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Face mood="waiting" size={15} ink={color.tube} />
          <Txt tone="tube" weight="bold" style={{ flex: 1 }}>Allow {row.name}?</Txt>
        </View>
        <Txt tone="tube" style={{ marginTop: 4 }}>{what || JSON.stringify(row.input)}</Txt>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Pressable onPress={() => onDecide(true)} disabled={!online} accessibilityRole="button" accessibilityLabel={`Allow ${row.name}`} style={({ pressed }) => [local.askBtn, { backgroundColor: color.tube, flex: 1 }, !online && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
            <Txt tone="amber" weight="bold">Allow</Txt>
          </Pressable>
          <Pressable onPress={() => onDecide(false)} disabled={!online} accessibilityRole="button" accessibilityLabel={`Deny ${row.name}`} style={({ pressed }) => [local.askBtn, { borderWidth: 1.5, borderColor: color.tube }, !online && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}>
            <Txt tone="tube" weight="bold">Deny</Txt>
          </Pressable>
        </View>
        {!online && <Txt tone="tube" small style={{ marginTop: 10 }}>Reconnecting. You can answer in a moment.</Txt>}
      </View>
    );

  const firstLine = row.result?.output.split('\n').find((l) => l.trim()) ?? '';
  return (
    <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${row.name} ${what}`} style={local.tool}>
      <Txt numberOfLines={expanded ? undefined : 1}>
        <Txt tone={row.decision === false ? 'raspberry' : row.result?.isError ? 'raspberry' : 'ghost'}>{row.decision === false ? '✕ ' : '▸ '}</Txt>
        <Txt weight="medium">{row.name}</Txt>
        <Txt tone="ghost">{'  ' + what}</Txt>
      </Txt>
      {row.decision === false && <Txt tone="raspberry" small style={local.under}>you denied this</Txt>}
      {!expanded && !!firstLine && <Txt tone={row.result?.isError ? 'raspberry' : 'ghost'} small numberOfLines={1} style={local.under}>{firstLine}</Txt>}
      {expanded && (
        <View style={local.under}>
          <Txt tone="ghost" small selectable>{JSON.stringify(row.input, null, 2)}</Txt>
          {!!row.result && <Txt tone={row.result.isError ? 'raspberry' : 'ghost'} small selectable style={{ marginTop: 8 }}>{row.result.output.split('\n').slice(0, 60).join('\n')}</Txt>}
        </View>
      )}
    </Pressable>
  );
}

function Chat({ agentId }: { agentId: string }) {
  const { events: all, activity, status, synced, post } = useConnection();
  const events = all[agentId] ?? NO_EVENTS;
  // Newest first, for an inverted list: it opens at the latest message and stays pinned there as more arrive.
  const rows = useMemo(() => toRows(events).reverse(), [events]);
  const [draft, setDraft] = useState('');
  const online = status === 'open';
  const state = activity[agentId] ?? 'idle';

  // What has been sent and not yet come back: a message until the agent's history shows it, and
  // answers until the agent says they are settled. Local network or relay, that is usually a blink.
  const [sent, setSent] = useState<{ text: string; after: number }>();
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  // A dropped line takes whatever was in flight with it, so stop saying it is on its way.
  const [wasOnline, setWasOnline] = useState(online);
  if (wasOnline !== online) {
    setWasOnline(online);
    setSent(undefined);
    setDeciding({});
  }
  const unechoed = sent && events.length <= sent.after ? sent.text : undefined;

  const send = () => {
    if (!draft.trim()) return;
    post({ type: 'prompt', agentId, text: draft });
    setSent({ text: draft.trim(), after: events.length });
    setDraft('');
  };
  const decide = (id: string) => (allow: boolean, answers?: Record<string, string>) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setDeciding((d) => ({ ...d, [id]: true }));
    post({ type: 'approve', agentId, id, allow, answers });
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Before the history has arrived, an empty conversation is not yet known to be empty. */}
      {rows.length === 0 && !unechoed && (synced ? <Empty>Nothing yet. Tell this agent what to do.</Empty> : <Loading hint="A long conversation takes a little longer to arrive.">Fetching the conversation…</Loading>)}
      <FlatList
        inverted
        data={rows}
        keyExtractor={(_, i) => String(rows.length - i)}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) =>
          item.kind === 'tool' ? (
            <ToolRow row={item} online={online} deciding={!!deciding[item.id]} onDecide={decide(item.id)} />
          ) : item.kind === 'user' ? (
            <View style={local.user}>
              <Txt tone="amber" weight="bold">❯</Txt>
              <Txt weight="medium" style={{ flex: 1 }} selectable>{item.text}</Txt>
            </View>
          ) : item.kind === 'text' ? (
            <View style={local.text}>
              <Markdown text={item.text} />
            </View>
          ) : (
            <Txt tone="raspberry" style={local.text} selectable>{item.text}</Txt>
          )
        }
        // The header of an inverted list sits at the bottom, under the newest message.
        ListHeaderComponent={
          <>
            {!!unechoed && (
              // Your message, shown the moment you send it and dimmed until the agent has it.
              <View style={[local.user, { opacity: 0.55 }]} accessibilityLabel={`Sending: ${unechoed}`}>
                <Spinner />
                <Txt weight="medium" style={{ flex: 1 }}>{unechoed}</Txt>
              </View>
            )}
            {!online ? (
              <Waiting tone="amber" hint="What is above is how things were when the line dropped." after={5} style={[local.user, { paddingTop: 8, flexDirection: 'column', gap: 0 }]}>Reconnecting to your Toto…</Waiting>
            ) : state === 'working' && !unechoed ? (
              <View style={[local.user, { paddingTop: 4 }]} accessibilityLabel="Working" accessibilityLiveRegion="polite">
                {/* The dots that count along beside the face do the job the word used to. */}
                <Face mood="working" size={13} trail />
              </View>
            ) : null}
          </>
        }
      />
      <View style={local.composer}>
        <Txt tone="amber" weight="bold" style={{ paddingVertical: 11 }}>❯</Txt>
        <TextInput
          style={[ui.input, { maxHeight: 120 }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={online ? 'Tell it what to do' : 'Reconnecting…'}
          placeholderTextColor={color.ghost}
          selectionColor={color.amber}
          keyboardAppearance="dark"
          multiline
          editable={online}
          accessibilityLabel="Message"
        />
        <Btn kind="primary" label="Send" onPress={send} disabled={!online || !draft.trim()} />
      </View>
    </View>
  );
}

export default function AgentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { agents, projects, post, loaded } = useConnection();
  const router = useRouter();
  const agent = agents.find((a) => a.id === id);
  const project = projects.find((p) => p.id === agent?.projectId);
  const auto = agent?.mode === 'auto';

  const toggleAuto = () => {
    if (auto) return post({ type: 'set_mode', agentId: id, mode: 'ask' });
    Alert.alert('Turn on full auto?', 'This agent will run commands and change files without asking, including anything waiting for approval now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn on', style: 'destructive', onPress: () => post({ type: 'set_mode', agentId: id, mode: 'auto' }) },
    ]);
  };

  const remove = () =>
    Alert.alert(
      `Delete ${agent?.name ?? 'this agent'}?`,
      agent?.worktree
        ? 'This stops the agent and removes its conversation and any work it has not committed. Its branch is kept.'
        : 'This stops the agent and removes its conversation. Files in the main checkout are left as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete agent',
          style: 'destructive',
          onPress: () => {
            post({ type: 'delete_agent', agentId: id });
            router.back();
          },
        },
      ],
    );

  const more = () =>
    Alert.alert(agent?.name ?? 'Agent', undefined, [
      { text: 'Delete agent', style: 'destructive', onPress: remove },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const small = { minHeight: 32, paddingHorizontal: 10 };
  return (
    <Screen bare>
      <Header
        parent={project?.name ?? 'toto'}
        title={agent?.name ?? (loaded ? 'gone' : '…')}
        right={
          <>
            {agent?.harness === 'claude' && (
              <Pressable onPress={toggleAuto} accessibilityRole="switch" accessibilityState={{ checked: auto }} accessibilityLabel="Full auto" hitSlop={8} style={[ui.btn, small, auto && { borderColor: color.amber }]}>
                <Txt tone={auto ? 'amber' : 'ghost'} weight={auto ? 'bold' : 'regular'}>{auto ? 'auto' : 'asks'}</Txt>
              </Pressable>
            )}
            <Btn label="···" onPress={more} spoken="More actions" style={small} />
          </>
        }
      />
      {!loaded ? (
        <Reaching what="the conversation" />
      ) : !agent ? (
        <Empty mood="offline">This agent is no longer on this Toto. It may have been deleted from another phone.</Empty>
      ) : agent.harness === 'terminal' ? (
        <Terminal agentId={id} />
      ) : (
        <Chat agentId={id} />
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  user: { flexDirection: 'row', gap: 10, paddingHorizontal: gutter, paddingTop: 16, paddingBottom: 4 },
  text: { paddingHorizontal: gutter, paddingVertical: 6 },
  tool: { paddingHorizontal: gutter, paddingVertical: 6, minHeight: 34 },
  under: { paddingLeft: 18 },
  ask: { backgroundColor: color.amber, padding: gutter, marginVertical: 8 },
  option: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1.5, borderColor: color.tube, borderRadius: 2, minHeight: tap },
  askBtn: { minHeight: tap + 4, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: gutter, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule, backgroundColor: color.bezel },
});
