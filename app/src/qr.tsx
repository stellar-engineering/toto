import makeQR from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';
import { color } from './theme';

/**
 * A QR code, drawn as plain squares so it needs no drawing library. Dark on light with a clear
 * margin, which is what cameras expect, whatever the rest of the screen looks like.
 */
export function QR({ value, size, label }: { value: string; size: number; label: string }) {
  const rows = useMemo(() => {
    // Type 0 picks the smallest code that fits; L is the least error correction, for the fewest
    // squares, which is right for something read off a bright screen a hand's width away.
    const code = makeQR(0, 'L');
    code.addData(value);
    code.make();
    const n = code.getModuleCount();
    // Each row as runs of dark and light, so a row is a handful of views and not one per square.
    return Array.from({ length: n }, (_, r) => {
      const runs: { dark: boolean; length: number }[] = [];
      for (let c = 0; c < n; c++) {
        const dark = code.isDark(r, c);
        if (runs.length && runs[runs.length - 1].dark === dark) runs[runs.length - 1].length++;
        else runs.push({ dark, length: 1 });
      }
      return runs;
    });
  }, [value]);
  const quiet = 4;
  // A whole number of points per square: fractions leave hairlines between rows that confuse a scanner.
  const cell = Math.max(2, Math.floor(size / (rows.length + 2 * quiet)));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignSelf: 'center', padding: cell * quiet, backgroundColor: color.phosphor }}>
      {rows.map((runs, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {runs.map((run, i) => (
            <View key={i} style={{ width: run.length * cell, height: cell, backgroundColor: run.dark ? color.tube : color.phosphor }} />
          ))}
        </View>
      ))}
    </View>
  );
}
