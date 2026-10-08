import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useConnection, type Node } from '../connection';
import { ping, type Route } from '../link';
import { Nearby } from '../nearby';
import { NodeForm } from '../nodeform';
import { Face } from '../face';
import { Header, Screen, Spinner, Txt, styles } from '../ui';

const CHECK_EVERY = 15_000;
type Reach = Route | 'offline' | 'checking';

function NodeRow({ node, reach, current, onPress }: { node: Node; reach: Reach; current: boolean; onPress: () => void }) {
  const online = reach === 'local' || reach === 'relay';
  const said = reach === 'checking' ? 'checking' : reach === 'offline' ? 'offline' : reach === 'relay' ? 'online, by relay' : 'online';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`${node.name}, ${said}${current ? ', showing now' : ''}`}>
      <View style={styles.faceCol}><Face mood={reach === 'checking' ? 'looking' : online ? 'awake' : 'offline'} size={13} /></View>
      <View style={{ flex: 1 }}>
        <Txt weight="bold" numberOfLines={1}>{node.name}</Txt>
        <Txt tone="ghost" small numberOfLines={1}>{node.address.replace(/^wss?:\/\//, '')}</Txt>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {reach === 'checking' && <Spinner />}
          <Txt tone={online ? 'signal' : 'ghost'}>{said}</Txt>
        </View>
        {current && <Txt tone="amber" small>showing now</Txt>}
      </View>
    </Pressable>
  );
}

export default function Nodes() {
  const { nodes, node: current, status, via, switchTo, learnName } = useConnection();
  const router = useRouter();
  const [reach, setReach] = useState<Record<string, Reach>>({});
  const [adding, setAdding] = useState(false);
  const [nearby, setNearby] = useState(false);

  // The current Toto's state is already known from its live connection. The others are asked,
  // now and every so often, for as long as this screen is in front.
  const latest = useRef({ nodes, currentId: current?.id, learnName });
  useEffect(() => {
    latest.current = { nodes, currentId: current?.id, learnName };
  });
  useFocusEffect(
    useCallback(() => {
      let watching = true;
      const check = () => {
        const { nodes, currentId, learnName } = latest.current;
        for (const n of nodes) {
          if (n.id === currentId) continue;
          ping(n).then((found) => {
            if (!watching) return;
            setReach((all) => ({ ...all, [n.id]: typeof found === 'string' ? 'offline' : found.via }));
            if (typeof found !== 'string') learnName(n.id, found.name);
          });
        }
      };
      check();
      const timer = setInterval(check, CHECK_EVERY);
      return () => {
        watching = false;
        clearInterval(timer);
      };
    }, []),
  );

  const reachOf = (n: Node): Reach => (n.id === current?.id ? (status === 'open' ? via : 'offline') : (reach[n.id] ?? 'checking'));

  if (nearby)
    return (
      <Screen bare>
        <Stack.Screen options={{ animation: 'slide_from_left' }} />
        <Header title="nearby" />
        <Nearby onAdded={() => router.back()} onCancel={() => setNearby(false)} />
      </Screen>
    );

  return (
    <Screen bare>
      {/* The top of the hierarchy, so it has nothing above it to show, and arrives from the left as going up a level should. */}
      <Stack.Screen options={{ animation: 'slide_from_left' }} />
      <Header title="totos" />
      <FlatList
        data={nodes}
        keyExtractor={(n) => n.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <NodeRow
            node={item}
            reach={reachOf(item)}
            current={item.id === current?.id}
            onPress={() => {
              switchTo(item.id);
              router.back();
            }}
          />
        )}
        ListFooterComponent={
          adding ? (
            <View style={styles.form}>
              <NodeForm onAdded={() => router.back()} onCancel={() => setAdding(false)} onNearby={() => setNearby(true)} />
            </View>
          ) : (
            <Pressable onPress={() => setAdding(true)} style={styles.row} accessibilityRole="button">
              <Txt tone="amber">+ Add a Toto</Txt>
            </Pressable>
          )
        }
      />
    </Screen>
  );
}
