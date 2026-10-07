// Working out what was typed from how a text field changed. Pure, and tested from the server's suite.
//
// A phone has no key events worth trusting, so the terminal keeps an invisible text field and
// watches its contents: characters added to the end were typed, characters missing from it were
// backspaced over.

// Phone keyboards "improve" punctuation as you type. A shell wants what was meant.
const PLAIN: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '—': '--', '–': '-', '…': '...' };

/** The keystrokes that turn a field holding `before` into one holding `after`. */
export function typed(before: string, after: string): { backspaces: number; text: string } {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  return {
    backspaces: before.length - same,
    text: after.slice(same).replace(/[‘’“”—–…]/g, (c) => PLAIN[c]),
  };
}

/**
 * What the field holds at rest: filler, so there is always something for backspace to delete.
 * Letters rather than spaces, which keyboards like to turn into ". ".
 */
export const FILLER = 'x'.repeat(40);
