'use client';

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock';

type CodeProps = { className?: string; children?: ReactNode };

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

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          // raw HTML stays escaped (no rehype-raw) — sanitized by default
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
          ),
          p: ({ node: _node, ...props }) => <p {...props} dir="auto" />,
          li: ({ node: _node, ...props }) => <li {...props} dir="auto" />,
          table: ({ node: _node, ...props }) => (
            <div className="table-wrap">
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
