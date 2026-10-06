import { common, createLowlight } from 'lowlight';
import { lexer, type Token, type Tokens } from 'marked';
import { memo, useMemo, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, font, size } from './theme';
import { Txt } from './ui';

// Markdown as a terminal would show it if terminals were kinder: headings in amber, code
// highlighted on a raised block, diffs in red and green, tables kept in their columns.

// ponytail: the 37 common languages. Register more grammars here if agents write in others.
const lowlight = createLowlight(common);

// What highlight.js calls each kind of token, and the palette colour it gets. Anything not
// listed (variables, properties, punctuation) stays the colour of plain text.
const SYNTAX: Record<string, string> = {
  keyword: color.raspberry,
  'selector-tag': color.raspberry,
  deletion: color.raspberry,
  string: color.signal,
  regexp: color.signal,
  symbol: color.signal,
  addition: color.signal,
  number: color.amber,
  literal: color.amber,
  built_in: color.amber,
  title: color.sky,
  type: color.sky,
  name: color.sky,
  section: color.sky,
  attr: color.sky, // keys in JSON and YAML, attributes in markup
  'selector-class': color.sky,
  'selector-id': color.sky,
  comment: color.ghost,
  quote: color.ghost,
  meta: color.ghost,
};

type Node = { type: string; value?: string; properties?: { className?: unknown }; children?: Node[] };

/** The highlighter's tree as nested `Text`, each coloured span inheriting from the one around it. */
function highlighted(nodes: Node[], at = ''): ReactNode {
  return nodes.map((node, i) => {
    if (node.type === 'text') return node.value;
    const kind = String((node.properties?.className as string[] | undefined)?.[0] ?? '').replace(/^hljs-/, '');
    return (
      <Text key={`${at}.${i}`} style={[SYNTAX[kind] ? { color: SYNTAX[kind] } : undefined, kind === 'comment' && styles.em]}>
        {highlighted(node.children ?? [], `${at}.${i}`)}
      </Text>
    );
  });
}

const openLink = (href: string) => {
  // Only ever hand the system a web address; agent output is not trusted to pick other schemes.
  if (/^https?:\/\//i.test(href)) Linking.openURL(href).catch(() => {});
};

/** Text-level markup. Uses bare `Text` so each piece inherits the colour of whatever it sits in. */
function inline(tokens: Token[] | undefined, at = ''): ReactNode {
  return tokens?.map((t, i) => {
    const key = `${at}.${i}`;
    switch (t.type) {
      case 'strong':
        return <Text key={key} style={styles.strong}>{inline(t.tokens, key)}</Text>;
      case 'em':
        return <Text key={key} style={styles.em}>{inline(t.tokens, key)}</Text>;
      case 'del':
        return <Text key={key} style={styles.del}>{inline(t.tokens, key)}</Text>;
      case 'codespan':
        return <Text key={key} style={styles.codespan}>{t.text}</Text>;
      case 'link':
        return <Text key={key} style={styles.link} accessibilityRole="link" onPress={() => openLink(t.href)}>{inline(t.tokens, key)}</Text>;
      case 'image':
        return <Text key={key} style={styles.link} accessibilityRole="link" onPress={() => openLink(t.href)}>{t.text || t.href}</Text>;
      case 'br':
        return '\n';
      case 'text':
        return 'tokens' in t && t.tokens ? inline(t.tokens, key) : t.text;
      case 'escape':
        return t.text;
      default:
        return t.raw; // raw HTML and anything unrecognised: show it as written
    }
  });
}

function Code({ token }: { token: Tokens.Code }) {
  const lines = token.text.split('\n');
  // "ts title=x.ts" and the like: the language is the first word.
  const lang = (token.lang ?? '').split(/\s/)[0].toLowerCase();
  const diff = lang === 'diff';
  const tree = useMemo(() => {
    if (diff || !lang || !lowlight.registered(lang)) return undefined;
    try {
      return lowlight.highlight(lang, token.text).children as Node[];
    } catch {
      return undefined; // a grammar tripping over odd input should cost the colours, not the message
    }
  }, [diff, lang, token.text]);
  return (
    <View style={styles.code}>
      {!!token.lang && <Txt tone="ghost" small style={styles.lang}>{token.lang}</Txt>}
      {/* Long lines scroll sideways; wrapping would wreck indentation. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Txt selectable style={styles.codeText}>
          {tree ? highlighted(tree) : lines.map((line, i) => (
            <Text key={i} style={diff ? (line.startsWith('+') ? styles.added : line.startsWith('-') ? styles.removed : line.startsWith('@@') ? styles.hunk : styles.context) : undefined}>
              {line + (i < lines.length - 1 ? '\n' : '')}
            </Text>
          ))}
        </Txt>
      </ScrollView>
    </View>
  );
}

const plain = (tokens: Token[]): string => tokens.map((t) => ('tokens' in t && t.tokens ? plain(t.tokens) : 'text' in t ? t.text : t.raw)).join('');

/** One typeface width for every character lets a table hold its columns with nothing but padding. */
function Table({ token }: { token: Tokens.Table }) {
  const rows = [token.header, ...token.rows];
  const widths = token.header.map((_, c) => Math.max(...rows.map((r) => plain(r[c]?.tokens ?? []).length)));
  const cell = (c: Tokens.TableCell, col: number, key: string) => {
    const gap = ' '.repeat(Math.max(0, widths[col] - plain(c.tokens).length));
    const right = token.align[col] === 'right';
    return <Text key={key}>{(col ? '  ' : '') + (right ? gap : '')}{inline(c.tokens, key)}{right ? '' : gap}</Text>;
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.block}>
      <View>
        <Txt tone="amber" weight="bold" selectable>{token.header.map((c, i) => cell(c, i, `h${i}`))}</Txt>
        <Txt tone="ghost">{widths.map((w) => '─'.repeat(w)).join('  ')}</Txt>
        {token.rows.map((row, r) => (
          <Txt key={r} selectable>{row.map((c, i) => cell(c, i, `${r}.${i}`))}</Txt>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ token, tight }: { token: Token; tight?: boolean }): ReactNode {
  switch (token.type) {
    case 'heading': {
      const t = token as Tokens.Heading;
      return (
        <Txt tone={t.depth <= 2 ? 'amber' : 'phosphor'} weight="bold" accessibilityRole="header" selectable style={[styles.heading, t.depth === 1 && { fontSize: size.large, lineHeight: 26 }]}>
          {inline(t.tokens)}
        </Txt>
      );
    }
    case 'paragraph':
    case 'text':
      return <Txt selectable style={tight ? undefined : styles.block}>{inline('tokens' in token && token.tokens ? token.tokens : [token])}</Txt>;
    case 'code':
      return <Code token={token as Tokens.Code} />;
    case 'list': {
      const t = token as Tokens.List;
      return (
        <View style={tight ? undefined : styles.block}>
          {t.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Txt tone={item.task && item.checked ? 'signal' : 'ghost'}>{item.task ? (item.checked ? '[x]' : '[ ]') : t.ordered ? `${Number(t.start || 1) + i}.` : '•'}</Txt>
              <View style={{ flex: 1 }}>
                {item.tokens.map((child, j) => (
                  <Block key={j} token={child} tight />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'blockquote':
      return (
        <View style={styles.quote}>
          {(token as Tokens.Blockquote).tokens.map((child, i) => (
            <Block key={i} token={child} tight />
          ))}
        </View>
      );
    case 'table':
      return <Table token={token as Tokens.Table} />;
    case 'hr':
      return <View style={styles.hr} />;
    case 'space':
    case 'checkbox': // drawn as the list item's marker
      return null;
    default:
      return <Txt selectable style={styles.block}>{token.raw}</Txt>;
  }
}

/** An agent's reply, rendered. Safe on partial text, so it can be used while a reply streams in. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => lexer(text), [text]);
  return (
    <View>
      {tokens.map((token, i) => (
        <Block key={i} token={token} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  block: { marginVertical: 5 },
  heading: { marginTop: 14, marginBottom: 2 },
  strong: { fontFamily: font.bold },
  em: { fontFamily: font.italic },
  del: { textDecorationLine: 'line-through', color: color.ghost },
  codespan: { color: color.signal, backgroundColor: color.bezel },
  link: { color: color.sky, textDecorationLine: 'underline' },
  item: { flexDirection: 'row', gap: 8, marginVertical: 1 },
  quote: { borderLeftWidth: 2, borderLeftColor: color.ghost, paddingLeft: 12, marginVertical: 5, opacity: 0.8 },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: color.ghost, marginVertical: 12 },
  code: { backgroundColor: color.bezel, borderRadius: 4, padding: 12, marginVertical: 6 },
  codeText: { color: color.phosphor, fontSize: 13, lineHeight: 19 },
  lang: { marginBottom: 4 },
  added: { color: color.signal },
  removed: { color: color.raspberry },
  hunk: { color: color.sky },
  context: { color: color.phosphor },
});
