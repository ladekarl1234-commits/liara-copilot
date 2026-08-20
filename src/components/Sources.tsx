'use client';

import type { Citation } from '@/types';

function ExternalIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

export default function Sources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <details className="sources" open={citations.length <= 2 || undefined}>
      <summary>منابع ({citations.length})</summary>
      <ul>
        {citations.map((c, i) => (
          <li key={`${c.url}-${i}`}>
            <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalIcon />
              <bdi dir="ltr">
                Liara Docs · {c.product} · {c.title}
                {c.heading ? ` · ${c.heading}` : ''}
              </bdi>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
