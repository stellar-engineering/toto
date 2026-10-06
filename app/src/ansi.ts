// Turns terminal output carrying ANSI colour and style codes into runs of styled text.
// Pure and free of React Native imports, so the server's test suite can run it.
//
// tmux does the real terminal emulation on the device and hands us a finished screen; what is
// left for us is SGR ("select graphic rendition"): colours, bold, underline and so on.

export type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
};
export type Span = Style & { text: string };

// The 16 named colours, tuned to sit with the app's palette. Index 0-7 normal, 8-15 bright.
const NAMED = [
  '#30362A', '#F25C82', '#8BD45F', '#FFB000', '#6CA8E0', '#C792EA', '#6FD8C8', '#ECE6D2',
  '#959B85', '#FF8FA8', '#B5F08A', '#FFD166', '#9CC8F5', '#DDB6F2', '#A6F0E0', '#FFFFFF',
];
const CUBE = [0, 95, 135, 175, 215, 255];
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((n) => (n & 255).toString(16).padStart(2, '0')).join('');

/** A colour from the 256-colour table. */
export function indexed(n: number): string | undefined {
  if (!(n >= 0 && n <= 255)) return undefined;
  if (n < 16) return NAMED[n];
  if (n >= 232) return hex(8 + 10 * (n - 232), 8 + 10 * (n - 232), 8 + 10 * (n - 232));
  const c = n - 16;
  return hex(CUBE[Math.floor(c / 36)], CUBE[Math.floor(c / 6) % 6], CUBE[c % 6]);
}

/** Applies one SGR sequence's parameters to a style. */
function sgr(style: Style, params: number[]): Style {
  let s = { ...style };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) s = {};
    else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 7) s.inverse = true;
    else if (p === 9) s.strike = true;
    else if (p === 22) s.bold = s.dim = false;
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p === 27) s.inverse = false;
    else if (p === 29) s.strike = false;
    else if (p >= 30 && p <= 37) s.fg = NAMED[p - 30];
    else if (p === 39) s.fg = undefined;
    else if (p >= 40 && p <= 47) s.bg = NAMED[p - 40];
    else if (p === 49) s.bg = undefined;
    else if (p >= 90 && p <= 97) s.fg = NAMED[p - 90 + 8];
    else if (p >= 100 && p <= 107) s.bg = NAMED[p - 100 + 8];
    else if (p === 38 || p === 48) {
      // Extended colour: 5;n from the table, or 2;r;g;b.
      let value: string | undefined;
      if (params[i + 1] === 5) {
        value = indexed(params[i + 2]);
        i += 2;
      } else if (params[i + 1] === 2) {
        value = hex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 4;
      }
      if (p === 38) s.fg = value;
      else s.bg = value;
    }
  }
  return s;
}

// CSI sequences (ESC [ params letter), OSC sequences (ESC ] ... BEL or ESC \), and two-byte escapes.
const ESCAPE = /\x1b\[([0-9;:]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78cDEHMNOZ]/g;

/**
 * Splits a screen into lines of styled spans. Style carries from one line to the next, as it
 * does in the terminal. Sequences other than SGR are dropped.
 */
export function parse(screen: string): Span[][] {
  let style: Style = {};
  return screen.split('\n').map((line) => {
    const spans: Span[] = [];
    const push = (text: string) => {
      if (text) spans.push({ ...style, text });
    };
    let from = 0;
    for (const match of line.matchAll(ESCAPE)) {
      push(line.slice(from, match.index));
      from = match.index + match[0].length;
      // Empty parameters mean 0, which also makes a bare ESC[m a reset. Colons are an alternate separator.
      if (match[2] === 'm') style = sgr(style, match[1].split(/[;:]/).filter((p, i, all) => p !== '' || all.length === 1).map(Number));
    }
    push(line.slice(from));
    return spans;
  });
}

/** Marks the character at `col` as the cursor, padding the line out to reach it if need be. */
export function withCursor(spans: Span[], col: number): (Span & { cursor?: boolean })[] {
  const out: (Span & { cursor?: boolean })[] = [];
  let at = 0;
  let placed = false;
  for (const span of spans) {
    const end = at + span.text.length;
    if (!placed && col >= at && col < end) {
      const i = col - at;
      if (i > 0) out.push({ ...span, text: span.text.slice(0, i) });
      out.push({ ...span, text: span.text[i], cursor: true });
      if (i + 1 < span.text.length) out.push({ ...span, text: span.text.slice(i + 1) });
      placed = true;
    } else out.push(span);
    at = end;
  }
  if (!placed) {
    if (col > at) out.push({ text: ' '.repeat(col - at) });
    out.push({ text: ' ', cursor: true });
  }
  return out;
}
