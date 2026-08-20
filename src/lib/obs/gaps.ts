// Documentation-gap recorder: JSONL append (fire-and-forget) + summary reader
// for the dev diag endpoint.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';

export interface GapEntry {
  normalizedQuestion: string;
  reason: 'low_confidence' | 'not_helpful' | 'insufficient_evidence' | 'repeated_clarification';
  product?: string;
  language: string;
}

export interface GapSummaryRow {
  question: string;
  count: number;
  reasons: Record<string, number>;
}

let warned = false;

function gapsFile(): string {
  return path.join(config().RUNTIME_DIR, 'gaps.jsonl');
}

export function recordGap(entry: GapEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.promises
    .mkdir(config().RUNTIME_DIR, { recursive: true })
    .then(() => fs.promises.appendFile(gapsFile(), line, 'utf8'))
    .catch((err: unknown) => {
      if (!warned) {
        warned = true;
        console.warn('gaps: append failed', err instanceof Error ? err.message : String(err));
      }
    });
}

/** Top normalized questions with counts and reason breakdown. */
export function readGapSummary(limit = 20): GapSummaryRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(gapsFile(), 'utf8');
  } catch {
    return [];
  }
  const byQuestion = new Map<string, GapSummaryRow>();
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    let e: Partial<GapEntry>;
    try {
      e = JSON.parse(line) as Partial<GapEntry>;
    } catch {
      continue; // torn write — skip
    }
    if (!e.normalizedQuestion || !e.reason) continue;
    let row = byQuestion.get(e.normalizedQuestion);
    if (!row) {
      row = { question: e.normalizedQuestion, count: 0, reasons: {} };
      byQuestion.set(e.normalizedQuestion, row);
    }
    row.count++;
    row.reasons[e.reason] = (row.reasons[e.reason] ?? 0) + 1;
  }
  return [...byQuestion.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
