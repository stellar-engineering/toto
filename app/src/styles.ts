import { Platform, StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16 },
  centred: { justifyContent: 'center', gap: 12 },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 12, fontSize: 16 },
  grow: { flex: 1, maxHeight: 120 },
  notice: { color: '#b00020' },
  muted: { color: '#666' },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  form: { gap: 10, paddingVertical: 16 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  event: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  user: { backgroundColor: '#eef3ff', paddingHorizontal: 8, borderRadius: 8 },
  label: { fontSize: 12, color: '#666', textTransform: 'uppercase', marginBottom: 2 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 16, paddingTop: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingVertical: 8 },
});
