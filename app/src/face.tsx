import { memo, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FRAMES, compact, type Mood } from './moods';
import { color, font } from './theme';

export type { Mood } from './moods';

// The colour a mood is drawn in. Amber already means "waiting on you" everywhere else in the app.
const INK: Record<Mood, string> = {
  awake: color.phosphor,
  working: color.phosphor,
  resting: color.phosphor,
  looking: color.phosphor,
  waiting: color.amber,
  failed: color.raspberry,
  offline: color.ghost,
};

// Asked once, shared by every face: has this person asked their phone for less motion?
let stillPlease: Promise<boolean> | undefined;
export const prefersStill = () => (stillPlease ??= AccessibilityInfo.isReduceMotionEnabled().catch(() => false));

type Props = {
  mood: Mood;
  /** Height of the characters. */
  size?: number;
  /** With `nose`, the face is two lines tall. Without, it is one line of five characters, for lists and running text. */
  nose?: boolean;
  /** On one line, still show what trails after the face (z's, counting dots). Needs four characters of room to its right. */
  trail?: boolean;
  /** Draw every character in this colour, for when the face sits on something other than the screen. */
  ink?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Toto's face. It is text, and it is decoration: whatever it shows is always also said in words
 * beside it, so screen readers skip it.
 */
export const Face = memo(function Face({ mood, size = 15, nose = false, trail = false, ink, style }: Props) {
  const frames = useMemo(() => (nose || trail ? FRAMES[mood] : compact(FRAMES[mood])), [mood, nose, trail]);
  const [at, setAt] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    let alive = true;
    prefersStill().then((yes) => alive && setStill(yes));
    return () => {
      alive = false;
    };
  }, []);

  // A new mood starts from its first frame. Derived during render, as React asks, rather than in an effect.
  const [shown, setShown] = useState(frames);
  if (shown !== frames) {
    setShown(frames);
    setAt(0);
  }

  const frame = frames[Math.min(at, frames.length - 1)];
  useEffect(() => {
    if (still || frames.length < 2) return;
    const timer = setTimeout(() => setAt((i) => (i + 1) % frames.length), frame.ms);
    return () => clearTimeout(timer);
  }, [at, frames, frame.ms, still]);

  const shownFrame = still ? frames[0] : frame;
  const main = ink ?? INK[mood];
  const type = { fontFamily: font.bold, fontSize: size, lineHeight: Math.round(size * 1.25), color: main } as const;
  return (
    // A fixed five characters wide, so z's and counting dots trail off to the right without
    // nudging the face, and a column of faces lines up.
    <View style={[{ width: size * 0.6 * 5, overflow: 'visible' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[type, { width: size * 0.6 * 9 }]} numberOfLines={1} allowFontScaling={false}>
        {shownFrame.face}
        {shownFrame.extra}
      </Text>
      {nose && (
        // Pulled up under the eyes: a whole line down is too far away to read as a nose.
        <Text style={[type, { marginTop: -size * 0.5, width: size * 0.6 * 5, textAlign: 'center', color: ink ?? (mood === 'awake' || mood === 'working' || mood === 'resting' ? color.amber : main) }]} allowFontScaling={false}>
          {shownFrame.nose}
        </Text>
      )}
    </View>
  );
});
