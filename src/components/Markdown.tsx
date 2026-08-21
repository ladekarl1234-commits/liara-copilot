'use client';

import { Children, isValidElement, useMemo, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Citation } from '@/types';
import CodeBlock from './CodeBlock';

type CodeProps = { className?: string; children?: ReactNode };

/** Any Persian/Arabic-script character. Used to pick a base direction for a whole
 *  block instead of letting `dir="auto"` infer one per node — see Markdown(). */
export const hasPersian = (t: string) => /[؀-ۿ]/.test(t);

/** Fenced code blocks arrive as <pre><code class="language-x hljs …">…</code></pre>. */
function Pre({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children).find((c): c is ReactElement<CodeProps> =>
    isValidElement(c),
  );
  if (!code) return <pre>{children}</pre>;
  const className = code.props.className ?? '';
  const language = /language-([\w+-]+)/.exec(className)?.[1];
  return (
    <CodeBlock language={language} codeClassName={className}>
      {code.props.children}
    </CodeBlock>
  );
}

/* ---------- inline [n] citation markers ---------- */

// Minimal structural view of the hast tree. Declared locally rather than importing
// `hast`/`unist-util-visit`, neither of which is a declared dependency here.
interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const hasChildren = (n: HastNode): n is HastElement =>
  Array.isArray((n as HastElement).children);

/** Elements whose text is literal and must not be rewritten. */
const OPAQUE = new Set(['code', 'pre', 'a', 'sup']);

const MARKER = /\[(\d{1,3})\]/g;

function linkify(value: string, byN: Map<number, Citation>): HastNode[] | null {
  MARKER.lastIndex = 0;
  const out: HastNode[] = [];
  let last = 0;
  let hit = false;
  for (let m = MARKER.exec(value); m !== null; m = MARKER.exec(value)) {
    const n = Number(m[1]);
    const c = byN.get(n);
    if (!c) continue;
    hit = true;
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    out.push({
      type: 'element',
      tagName: 'sup',
      properties: { className: ['cite-marker'] },
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: c.url,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            title: c.heading ? `${c.title} · ${c.heading}` : c.title,
            'aria-label': `منبع ${n}: ${c.title}`,
          },
          children: [{ type: 'text', value: `[${n}]` }],
        },
      ],
    });
    last = m.index + m[0].length;
  }
  if (!hit) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

/**
 * Turn inline `[n]` markers into anchors on the matching citation's deep link.
 * Markers with no matching citation stay literal text, which is what a partially
 * streamed answer looks like before the `citations` event arrives.
 */
export function citationPlugin(citations: Citation[]) {
  const byN = new Map<number, Citation>();
  for (const c of citations) if (c.n != null) byN.set(c.n, c);
  return () => (tree: HastNode) => {
    if (byN.size === 0) return;
    const walk = (node: HastNode) => {
      if (!hasChildren(node)) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && !OPAQUE.has((node as HastElement).tagName)) {
          const parts = linkify((child as HastText).value, byN);
          if (parts) {
            next.push(...parts);
            continue;
          }
        }
        walk(child);
        next.push(child);
      }
      node.children = next;
    };
    walk(tree);
  };
}

/** Stable identity so the rehype plugin isn't rebuilt on every streaming delta. */
const NO_CITATIONS: Citation[] = [];

export default function Markdown({
  children,
  citations = NO_CITATIONS,
}: {
  children: string;
  citations?: Citation[];
}) {
  // One base direction for the whole answer, taken from the answer's own language.
  // `dir="auto"` infers per node from the FIRST strong character, so a Persian
  // paragraph that opens with a command ("`liara deploy` را اجرا کنید") flips to
  // LTR — the modal shape for a CLI-heavy docs assistant (UX-02).
  const dir = hasPersian(children) ? 'rtl' : 'ltr';

  const rehypePlugins = useMemo<Options['rehypePlugins']>(
    () => [rehypeHighlight, citationPlugin(citations)],
    [citations],
  );

  return (
    <div className="md" dir={dir}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          pre: Pre,
          // raw HTML stays escaped (no rehype-raw) — sanitized by default
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
          ),
          // Model-authored headings are downshifted two levels so answer content
          // never outranks the page's own h1/h2 structure (A11Y-05).
          h1: ({ node: _node, ...props }) => <h3 {...props} />,
          h2: ({ node: _node, ...props }) => <h4 {...props} />,
          h3: ({ node: _node, ...props }) => <h5 {...props} />,
          h4: ({ node: _node, ...props }) => <h6 {...props} />,
          table: ({ node: _node, ...props }) => (
            // tabIndex: a scroll container with no focusable content is otherwise
            // unreachable by keyboard and cannot be panned (SC 2.1.1).
            <div className="table-wrap" tabIndex={0} role="group" aria-label="جدول">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
