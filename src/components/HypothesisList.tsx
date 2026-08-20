'use client';

import type { Hypothesis, SessionState } from '@/types';

type Troubleshooting = NonNullable<SessionState['troubleshooting']>;

const MARK: Record<Hypothesis['status'], string> = {
  untested: '○',
  testing: '●',
  rejected: '✕',
  confirmed: '✓',
};

export default function HypothesisList({ state }: { state: Troubleshooting }) {
  return (
    <div className="panel">
      <ul>
        {state.hypotheses.map((h) => (
          <li key={h.id} className={`hyp hyp-${h.status}`}>
            <span className="hyp-mark" aria-hidden="true">
              {MARK[h.status]}
            </span>
            <span className="hyp-text" dir="auto">
              {h.text}
            </span>
          </li>
        ))}
      </ul>
      {state.resolved && (
        <div className="resolved">
          <p className="resolved-line">برطرف شد ✓</p>
          {state.rootCause && (
            <p className="root-cause" dir="auto">
              {state.rootCause}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
