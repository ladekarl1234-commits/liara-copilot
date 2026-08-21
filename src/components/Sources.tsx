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
              {c.n != null && <span className="source-n">[{c.n}]</span>}
              {/* One <bdi> per homogeneous fragment. A single LTR bdi around the
                  whole label put the separators and any bracketed Latin run on the
                  wrong side of the Persian title (99.6% of indexed titles are
                  Persian); bdi's default `dir=auto` is per-element and correct
                  here because each fragment is single-script. lang="en" keeps a
                  Persian TTS voice from mangling the Latin half (A11Y-11). */}
              <bdi lang="en" dir="ltr">
                Liara Docs · {c.product}
              </bdi>
              {' · '}
              <bdi>{c.title}</bdi>
              {c.heading ? (
                <>
                  {' · '}
                  <bdi>{c.heading}</bdi>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
