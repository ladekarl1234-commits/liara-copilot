'use client';

import type { SessionState, WorkflowStep } from '@/types';

type Workflow = NonNullable<SessionState['workflow']>;

const MARK: Record<WorkflowStep['status'], string> = {
  done: '✓',
  current: '→',
  pending: '○',
};

// The glyph is aria-hidden and the only other status carrier is colour, so the
// checklist was semantically flat to assistive tech and failed 1.4.1 for
// low-vision users. Each item now states its status in words (A11Y-06).
const STATUS_FA: Record<WorkflowStep['status'], string> = {
  done: 'انجام‌شده',
  current: 'در حال انجام',
  pending: 'باقی‌مانده',
};

export default function WorkflowChecklist({ workflow }: { workflow: Workflow }) {
  return (
    <div className="panel">
      {workflow.goal && <p className="panel-title">{workflow.goal}</p>}
      {workflow.detected.length > 0 && (
        <p className="panel-sub">
          <bdi>{workflow.detected.join(' · ')}</bdi>
        </p>
      )}
      <ul>
        {workflow.steps.map((s) => (
          <li key={s.id} className={`step step-${s.status}`}>
            <span className="step-mark" aria-hidden="true">
              {MARK[s.status]}
            </span>
            <span className="sr-only">{STATUS_FA[s.status]}: </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
