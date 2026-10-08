import { usePathname, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConnection, type Agent } from './connection';
import { Face } from './face';
import { moodOf } from './moods';
import { color, gutter, tap } from './theme';
import { Btn, StatusLine, Txt, styles as ui } from './ui';

export const SIDEBAR = 300;

/**
 * On a wide screen: everything on this Toto down the left, always there, so getting from one
 * agent to another is one click and never a trip back up through the lists.
 */
export function Sidebar() {
  const router = useRouter();
  const path = usePathname();
  const { node, projects, agents, activity, claude, loaded, status, trying } = useConnection();

  const agentRow = (agent: Agent) => {
    const here = path === `/agent/${agent.id}`;
    const state = activity[agent.id] ?? 'idle';
    const terminal = agent.harness === 'terminal';
    return (
      <Pressable key={agent.id} onPress={() => router.navigate({ pathname: '/agent/[id]', params: { id: agent.id } })} accessibilityRole="link" accessibilityState={{ selected: here }} accessibilityLabel={`${agent.name}, ${terminal ? 'terminal' : state}`} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [local.agent, (here || hovered) && local.lit, here && local.here, pressed && { opacity: 0.6 }]}>
        <View style={{ width: 44 }}>{terminal ? <Txt tone="ghost" weight="bold">  $</Txt> : <Face mood={moodOf(state)} size={12} />}</View>
        <Txt weight={here ? 'bold' : 'regular'} numberOfLines={1} style={{ flex: 1 }}>{agent.name}</Txt>
        {!terminal && state === 'waiting' && <Txt tone="amber" weight="bold" small>waiting</Txt>}
        {!terminal && state === 'working' && <Txt tone="signal" small>working</Txt>}
        {!terminal && state === 'failed' && <Txt tone="raspberry" small>stopped</Txt>}
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={local.bar}>
      <View style={[ui.header, { gap: 8 }]}>
        <Pressable onPress={() => router.navigate('/nodes')} accessibilityRole="link" accessibilityLabel="All your Totos" style={({ pressed }) => [{ flex: 1, minHeight: tap, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
          <Txt numberOfLines={1}>
            <Txt tone="ghost">totos / </Txt>
            <Txt weight="bold">{node?.name ?? 'toto'}</Txt>
          </Txt>
        </Pressable>
        <Btn label="settings" onPress={() => router.navigate('/device')} spoken={`Settings for ${node?.name ?? 'this Toto'}`} style={{ minHeight: 32, paddingHorizontal: 10 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
        {claude === 'none' && (
          <Pressable onPress={() => router.navigate('/claude')} accessibilityRole="link" style={({ pressed }) => [local.project, pressed && { opacity: 0.6 }]}>
            <Txt tone="amber" weight="bold">Sign in to Claude</Txt>
          </Pressable>
        )}
        {!loaded && (
          <Txt tone="ghost" small style={local.note}>{status === 'open' ? 'Fetching…' : trying.why === 'refused' ? 'Access was taken away.' : 'Reaching your Toto…'}</Txt>
        )}
        {projects.map((project) => {
          const here = path === `/project/${project.id}`;
          const mine = agents.filter((a) => a.projectId === project.id);
          return (
            <View key={project.id} style={{ marginBottom: 12 }}>
              <Pressable onPress={() => router.navigate({ pathname: '/project/[id]', params: { id: project.id } })} accessibilityRole="link" accessibilityState={{ selected: here }} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [local.project, (here || hovered) && local.lit, here && local.here, pressed && { opacity: 0.6 }]}>
                <Txt tone="ghost" weight="bold" numberOfLines={1}>{project.name}</Txt>
              </Pressable>
              {mine.map(agentRow)}
              {mine.length === 0 && <Txt tone="ghost" small style={local.note}>No agents yet.</Txt>}
            </View>
          );
        })}
        {loaded && (
          <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" style={({ pressed }) => [local.project, pressed && { opacity: 0.6 }]}>
            <Txt tone="amber">{projects.length ? 'All projects' : '+ Add a project'}</Txt>
          </Pressable>
        )}
      </ScrollView>
      <StatusLine always />
    </SafeAreaView>
  );
}

const local = StyleSheet.create({
  bar: { width: SIDEBAR, backgroundColor: color.tube, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: color.rule },
  project: { minHeight: 36, justifyContent: 'center', paddingHorizontal: gutter, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  agent: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: gutter, paddingRight: gutter, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  lit: { backgroundColor: color.bezel },
  here: { borderLeftColor: color.amber },
  note: { paddingHorizontal: gutter + 2, paddingVertical: 6 },
});
