import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, Image, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection, type ImageRef } from './connection';
import { savePicture } from './save';
import { color, gutter, tap } from './theme';
import { Btn, Spinner, Txt } from './ui';

/** A picture chosen to send, made small enough to be worth sending. */
export type Attached = { uri: string; mime: string; base64: string };

// The longest side a picture is sent at. Past this the model sees no more, and it only costs time on a phone's connection.
const LONGEST = 1568;

/** Lets the person choose pictures from their phone or computer. Resolves to none if they change their mind. */
export async function choosePictures(): Promise<Attached[]> {
  const chosen = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4, quality: 1 });
  if (chosen.canceled || !chosen.assets) return [];
  const ready: Attached[] = [];
  for (const asset of chosen.assets.slice(0, 4)) {
    const context = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > LONGEST) context.resize(asset.width >= asset.height ? { width: LONGEST } : { height: LONGEST });
    const made = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
    if (made.base64) ready.push({ uri: made.uri, mime: 'image/jpeg', base64: made.base64 });
  }
  return ready;
}

const kb = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The pictures in one message or one tool's result, small. Each is fetched from the Toto when it
 * first comes on screen. Tapping one opens it full size, with a way to save it.
 */
export function Pictures({ agentId, images }: { agentId: string; images: ImageRef[] }) {
  const { pictures, wantPicture, status } = useConnection();
  const [open, setOpen] = useState<ImageRef>();
  useEffect(() => {
    if (status === 'open') for (const image of images) wantPicture(agentId, image);
    // `wantPicture` is new each render and does nothing for a picture it already has or has asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, images, status]);

  return (
    <View style={local.strip}>
      {images.map((image) => {
        const data = pictures[image.id];
        return (
          <Pressable key={image.id} onPress={() => data && setOpen(image)} disabled={!data} accessibilityRole="imagebutton" accessibilityLabel={data ? 'Picture. Opens full size.' : 'Picture, loading'} style={({ pressed }) => [local.thumb, pressed && { opacity: 0.7 }]}>
            {data ? (
              <Image source={{ uri: `data:${image.mime};base64,${data}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            ) : (
              <View style={{ alignItems: 'center', gap: 6 }}>
                <Spinner wide />
                <Txt tone="ghost" small>{status === 'open' ? `picture, ${kb(image.bytes)}` : 'waiting for your Toto'}</Txt>
              </View>
            )}
          </Pressable>
        );
      })}
      {open && <Lightbox image={open} data={pictures[open.id]} onClose={() => setOpen(undefined)} />}
    </View>
  );
}

/** One picture, as large as the screen allows, with nothing else on it but how to save it and how to leave. */
function Lightbox({ image, data, onClose }: { image: ImageRef; data: string | undefined; onClose: () => void }) {
  const { top, bottom } = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!data) return;
    setSaving(true);
    await savePicture(image.id, image.mime, data).catch(() => Alert.alert('That did not work', 'The picture could not be saved.'));
    setSaving(false);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[local.dark, { paddingTop: top, paddingBottom: bottom }]}>
        <View style={local.bar}>
          <Txt tone="ghost" small style={{ flex: 1 }}>{kb(image.bytes)}</Txt>
          <Btn label={saving ? 'Saving…' : 'Save'} busy={saving} onPress={save} disabled={!data} style={local.small} />
          <Btn label="Close" onPress={onClose} style={local.small} />
        </View>
        {/* Anywhere on the picture closes it too, as a lightbox should; and it can be pinched larger. */}
        {!!data && <Zoomable uri={`data:${image.mime};base64,${data}`} onTap={onClose} />}
      </View>
    </Modal>
  );
}

type View2D = { scale: number; x: number; y: number };
const WHOLE: View2D = { scale: 1, x: 0, y: 0 };
const MOST = 6;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/**
 * The state of a pinch and drag on a picture, and the responder that reads the fingers. A class so
 * that what changes under the fingers can change without waiting for a render. Written with the
 * responder system React Native already has, not a gesture library, which would be native code to
 * add for one screen.
 */
class Zoom {
  view = WHOLE;
  // Where the picture's area is on screen, to pinch about the fingers and not about its middle.
  area = { x: 0, y: 0, width: Dimensions.get('window').width, height: Dimensions.get('window').height };
  // How things stood when the fingers last changed in number, and where they were.
  private from?: { fingers: number; mid: { x: number; y: number }; gap: number; view: View2D };

  constructor(private show: (view: View2D) => void) {}

  put(view: View2D) {
    this.view = view;
    this.show(view);
  }

  responder = PanResponder.create({
    // Taps are the picture's own; this only takes over for two fingers, or a drag once enlarged.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (e, g) => e.nativeEvent.touches.length >= 2 || (this.view.scale > 1 && Math.abs(g.dx) + Math.abs(g.dy) > 4),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (!t.length) return;
      const two = t.length >= 2;
      const mid = two ? { x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 } : { x: t[0].pageX, y: t[0].pageY };
      const gap = two ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
      const fingers = two ? 2 : 1;
      // A finger put down or lifted starts again from where things stand, so the picture does not jump.
      if (this.from?.fingers !== fingers) {
        this.from = { fingers, mid, gap, view: this.view };
        return;
      }
      const f = this.from;
      const scale = two ? clamp((f.view.scale * gap) / Math.max(f.gap, 1), 1, MOST) : f.view.scale;
      // Keeps the point that was under the fingers under them: screen = centre + shift + scale * point.
      const cx = this.area.x + this.area.width / 2;
      const cy = this.area.y + this.area.height / 2;
      const ratio = scale / f.view.scale;
      const reach = { x: ((scale - 1) * this.area.width) / 2, y: ((scale - 1) * this.area.height) / 2 };
      this.put({
        scale,
        x: clamp(mid.x - cx - ratio * (f.mid.x - cx - f.view.x), -reach.x, reach.x),
        y: clamp(mid.y - cy - ratio * (f.mid.y - cy - f.view.y), -reach.y, reach.y),
      });
    },
    onPanResponderRelease: () => {
      this.from = undefined;
      if (this.view.scale < 1.05) this.put(WHOLE);
    },
    onPanResponderTerminate: () => {
      this.from = undefined;
    },
  });
}

/** A picture that can be pinched larger and dragged about while it is. A tap puts it back if it was enlarged, and otherwise is `onTap`. */
function Zoomable({ uri, onTap }: { uri: string; onTap: () => void }) {
  const [view, setView] = useState(WHOLE);
  const [zoom] = useState(() => new Zoom(setView));
  const box = useRef<View>(null);
  return (
    <View
      ref={box}
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={() => box.current?.measureInWindow((x, y, width, height) => (zoom.area = { x, y, width, height }))}
      {...zoom.responder.panHandlers}>
      <Pressable onPress={() => (zoom.view.scale > 1 ? zoom.put(WHOLE) : onTap())} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel="Picture. Pinch to zoom. Tap to close.">
        <Image
          source={{ uri }}
          style={{ flex: 1, transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.scale }] }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    </View>
  );
}

/** Pictures chosen and not yet sent, above the message box, each with a way to take it back out. */
export function Attachments({ attached, onRemove }: { attached: Attached[]; onRemove: (index: number) => void }) {
  if (!attached.length) return null;
  return (
    <View style={[local.strip, { paddingHorizontal: gutter, paddingTop: 10 }]}>
      {attached.map((a, i) => (
        <View key={a.uri} style={local.chosen}>
          <Image source={{ uri: a.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          <Pressable onPress={() => onRemove(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove this picture" style={local.remove}>
            <Txt weight="bold" small>x</Txt>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { width: 240, height: 160, maxWidth: '100%', backgroundColor: color.bezel, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule, alignItems: 'center', justifyContent: 'center' },
  dark: { flex: 1, backgroundColor: 'rgba(8, 10, 7, 0.97)' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: tap, paddingHorizontal: gutter, paddingVertical: 8 },
  small: { minHeight: 36, paddingHorizontal: 14 },
  chosen: { width: 64, height: 64, backgroundColor: color.bezel, borderWidth: StyleSheet.hairlineWidth, borderColor: color.rule },
  remove: { position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: color.tube, borderWidth: 1, borderColor: color.rule, alignItems: 'center', justifyContent: 'center' },
});
