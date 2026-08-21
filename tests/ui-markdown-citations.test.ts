// UX-06: inline [n] markers were inert text, so the deep anchors in each
// citation's url were never reachable by the natural gesture. The rehype step
// that links them is pure tree rewriting, so it is testable without a DOM.
import { describe, expect, it } from 'vitest';
import { citationPlugin, hasPersian } from '@/components/Markdown';
import type { Citation } from '@/types';

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const CITATIONS: Citation[] = [
  { n: 1, title: 'ساخت RAG Chatbot', heading: 'ساخت (build)', url: 'https://docs.liara.ir/ai/cookbook/rag-chatbot/#build', product: 'ai' },
  { n: 2, title: 'استقرار Next.js', url: 'https://docs.liara.ir/paas/nextjs/', product: 'paas' },
];

const run = (tree: Node, citations = CITATIONS) => {
  citationPlugin(citations)()(tree);
  return tree;
};

const para = (text: string): Node => ({
  type: 'element',
  tagName: 'p',
  children: [{ type: 'text', value: text }],
});

describe('citationPlugin', () => {
  it('turns a known [n] into a superscript anchor on that citation url', () => {
    const tree = run(para('ابتدا برنامه را بسازید [1]. سپس مستقر کنید [2].'));
    const kids = tree.children ?? [];
    const sups = kids.filter((c) => c.tagName === 'sup');
    expect(sups).toHaveLength(2);

    const a = sups[0]?.children?.[0];
    expect(a?.tagName).toBe('a');
    expect(a?.properties?.href).toBe('https://docs.liara.ir/ai/cookbook/rag-chatbot/#build');
    expect(a?.properties?.['aria-label']).toBe('منبع 1: ساخت RAG Chatbot');
    expect(a?.children?.[0]?.value).toBe('[1]');

    // The surrounding Persian prose survives intact and in order.
    expect(kids.map((c) => c.value ?? '[sup]').join('')).toBe(
      'ابتدا برنامه را بسازید [sup]. سپس مستقر کنید [sup].',
    );
  });

  it('leaves markers with no matching citation as literal text', () => {
    // This is what a partially streamed answer looks like before the
    // `citations` event arrives — it must not lose or mangle the text.
    const tree = run(para('طبق مستندات [7] این کار شدنی است.'));
    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0]?.value).toBe('طبق مستندات [7] این کار شدنی است.');
  });

  it('does nothing at all when there are no citations yet', () => {
    const tree = run(para('پاسخ در حال نوشته شدن است [1]'), []);
    expect(tree.children?.[0]?.value).toBe('پاسخ در حال نوشته شدن است [1]');
  });

  it('never rewrites code, links or existing markers', () => {
    for (const tag of ['code', 'pre', 'a', 'sup']) {
      const tree = run({
        type: 'element',
        tagName: tag,
        children: [{ type: 'text', value: 'liara logs [1]' }],
      });
      expect(tree.children, tag).toHaveLength(1);
      expect(tree.children?.[0]?.value, tag).toBe('liara logs [1]');
    }
  });

  it('descends into nested elements', () => {
    const tree = run({
      type: 'root',
      children: [
        { type: 'element', tagName: 'ul', children: [
          { type: 'element', tagName: 'li', children: [{ type: 'text', value: 'گام اول [2]' }] },
        ] },
      ],
    });
    const li = tree.children?.[0]?.children?.[0];
    expect(li?.children?.some((c) => c.tagName === 'sup')).toBe(true);
  });
});

describe('hasPersian', () => {
  it('drives one base direction per answer instead of per paragraph', () => {
    // The exact shape that dir="auto" got wrong: Persian prose opening with a
    // Latin command (UX-02).
    expect(hasPersian('`liara deploy` را اجرا کنید.')).toBe(true);
    expect(hasPersian('MongoDB را به برنامه وصل کنید')).toBe(true);
    expect(hasPersian('Run liara deploy to ship.')).toBe(false);
  });
});
