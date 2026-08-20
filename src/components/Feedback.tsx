'use client';

import { useState } from 'react';

type Verdict = 'helpful' | 'not_helpful' | 'not_solved';

function ThumbUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

export default function Feedback({
  sessionId,
  messageId,
  onStillBroken,
}: {
  sessionId: string | null;
  messageId: string;
  onStillBroken: () => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const post = (v: Verdict) => {
    setVerdict(v); // optimistic; failures ignored silently
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId ?? '', messageId, verdict: v }),
    }).catch(() => {});
  };

  return (
    <div className="feedback">
      <button
        type="button"
        className={`fb-btn ${verdict === 'helpful' ? 'active' : ''}`}
        aria-label="پاسخ مفید بود"
        aria-pressed={verdict === 'helpful'}
        onClick={() => post('helpful')}
      >
        <ThumbUpIcon />
      </button>
      <button
        type="button"
        className={`fb-btn ${verdict === 'not_helpful' || verdict === 'not_solved' ? 'active' : ''}`}
        aria-label="پاسخ مفید نبود"
        aria-pressed={verdict === 'not_helpful' || verdict === 'not_solved'}
        onClick={() => post('not_helpful')}
      >
        <ThumbDownIcon />
      </button>
      {verdict === 'not_helpful' && (
        <button
          type="button"
          className="fb-text"
          onClick={() => {
            post('not_solved');
            onStillBroken();
          }}
        >
          هنوز حل نشده
        </button>
      )}
    </div>
  );
}
