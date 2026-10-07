import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useConnection, type AgentEvent } from '../../connection';
import { Markdown } from '../../markdown';
import { Terminal } from '../../terminal';
import { color, gutter, tap } from '../../theme';
import { Face } from '../../face';
import { Btn, Empty, Header, Screen, Txt, styles as ui } from '../../ui';

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

function ToolRow({ row, onDecide }: { row: Extract<Row, { kind: 'tool' }>; onDecide: (allow: boolean) => void }) {
  const [expanded, setExpanded] = useState(false);
  const what = brief(row.input);

  // The moment the whole app exists for: an agent has stopped and is waiting on you.
  if (row.decision === 'waiting')
    return (
      <View style={local.ask} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Face mood="waiting" size={15} ink={color.tube} />
          <Txt tone="tube" weight="bold" style={{ flex: 1 }}>Allow {row.name}?</Txt>
        </View>
        <Txt tone="tube" style={{ marginTop: 4 }}>{what || JSON.stringify(row.input)}</Txt>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Pressable onPress={() => onDecide(true)} accessibilityRole="button" accessibilityLabel={`Allow ${row.name}`} style={({ pressed }) => [local.askBtn, { backgroundColor: color.tube, flex: 1 }, pressed && { opacity: 0.7 }]}>
            <Txt tone="amber" weight="bold">Allow</Txt>
          </Pressable>
          <Pressable onPress={() => onDecide(false)} accessibilityRole="button" accessibilityLabel={`Deny ${row.name}`} style={({ pressed }) => [local.askBtn, { borderWidth: 1.5, borderColor: color.tube }, pressed && { opacity: 0.7 }]}>
            <Txt tone="tube" weight="bold">Deny</Txt>
          </Pressable>
        </View>
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
  const { events: all, activity, status, post } = useConnection();
  const events = all[agentId] ?? NO_EVENTS;
  // Newest first, for an inverted list: it opens at the latest message and stays pinned there as more arrive.
  const rows = useMemo(() => toRows(events).reverse(), [events]);
  const [draft, setDraft] = useState('');
  const online = status === 'open';
  const state = activity[agentId] ?? 'idle';

  const send = () => {
    if (!draft.trim()) return;
    post({ type: 'prompt', agentId, text: draft });
    setDraft('');
  };
  const decide = (id: string) => (allow: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    post({ type: 'approve', agentId, id, allow });
  };

  return (
    <View style={{ flex: 1 }}>
      {rows.length === 0 && <Empty>Nothing yet. Tell this agent what to do.</Empty>}
      <FlatList
        inverted
        data={rows}
        keyExtractor={(_, i) => String(rows.length - i)}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) =>
          item.kind === 'tool' ? (
            <ToolRow row={item} onDecide={decide(item.id)} />
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
          !online ? (
            <View style={[local.user, { paddingTop: 4, alignItems: 'center' }]}>
              <Face mood="looking" size={13} />
              <Txt tone="amber">Reconnecting to your Toto…</Txt>
            </View>
          ) : state === 'working' ? (
            <View style={[local.user, { paddingTop: 4 }]} accessibilityLabel="Working" accessibilityLiveRegion="polite">
              {/* The dots that count along beside the face do the job the word used to. */}
              <Face mood="working" size={13} trail />
            </View>
          ) : null
        }
      />
      <View style={local.composer}>
        <Txt tone="amber" weight="bold" style={{ paddingVertical: 11 }}>❯</Txt>
        <TextInput
          style={[ui.input, { maxHeight: 120 }]}
          value={draft}
          onChangeText={setDraft}
          placeholder={online ? 'Tell it what to do' : 'Offline'}
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
  const { agents, projects, post } = useConnection();
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
        title={agent?.name ?? 'gone'}
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
      {agent?.harness === 'terminal' ? <Terminal agentId={id} /> : <Chat agentId={id} />}
    </Screen>
  );
}

const local = StyleSheet.create({
  user: { flexDirection: 'row', gap: 10, paddingHorizontal: gutter, paddingTop: 16, paddingBottom: 4 },
  text: { paddingHorizontal: gutter, paddingVertical: 6 },
  tool: { paddingHorizontal: gutter, paddingVertical: 6, minHeight: 34 },
  under: { paddingLeft: 18 },
  ask: { backgroundColor: color.amber, padding: gutter, marginVertical: 8 },
  askBtn: { minHeight: tap + 4, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: gutter, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.rule, backgroundColor: color.bezel },
});
