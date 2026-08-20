'use client';

import type { SessionState, WorkflowStep } from '@/types';

type Workflow = NonNullable<SessionState['workflow']>;

const MARK: Record<WorkflowStep['status'], string> = {
  done: '✓',
  current: '→',
  pending: '○',
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
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
