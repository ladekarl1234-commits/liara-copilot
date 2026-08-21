// Documentation-gap recorder: JSONL append (fire-and-forget) + summary reader
// for the dev diag endpoint.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import { log } from '@/lib/obs/log';
import { redactSecrets } from '@/lib/security/redact';

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
const MAX_GAP_BYTES = 5 * 1024 * 1024; // rotate past 5MB so the file can't grow unbounded (OBS2-002)
/** Newest slice of the file the summary is computed from — see readGapSummary. */
const SUMMARY_TAIL_BYTES = 256 * 1024;
/** The file only changes when a gap is recorded; re-parsing per request is waste. */
const SUMMARY_TTL_MS = 30_000;

function gapsFile(): string {
  return path.join(config().RUNTIME_DIR, 'gaps.jsonl');
}

/** Max stored question length — a gap key is a topic, not a transcript. */
const MAX_QUESTION_CHARS = 500;

/**
 * Serializes every append. Two concurrent requests could both observe
 * `size > MAX_GAP_BYTES` and both rename, so the second rotation threw away the
 * generation the first had just rotated (EP-SCALE-12). A promise chain is the
 * whole mutex; appends are fire-and-forget so nobody waits on it.
 */
let appendQueue: Promise<void> = Promise.resolve();

export function recordGap(entry: GapEntry): void {
  // normalizedQuestion is verbatim user text on every call site (a question, or
  // a feedback comment) and /api/diag serves it back. Redact HERE, at the one
  // point all callers route through, so a new call site cannot forget
  // (EP-SEC-01).
  const record = {
    ts: new Date().toISOString(),
    ...entry,
    normalizedQuestion: redactSecrets(entry.normalizedQuestion).slice(0, MAX_QUESTION_CHARS),
  };
  // Also emit to stdout: the JSONL file is per-instance and dies with the
  // container's disk, so behind more than one replica the /internal gap summary
  // shows one replica's partial view. The log pipeline is the thing that
  // actually aggregates across instances and survives a restart (EP-SCALE-12).
  log('info', 'doc_gap', { ...record });
  const line = JSON.stringify(record) + '\n';
  appendQueue = appendQueue
    .then(() => fs.promises.mkdir(config().RUNTIME_DIR, { recursive: true }))
    .then(async () => {
      // bounded: rotate to .1 once the file exceeds the cap (keeps one previous
      // generation, discards older) so gaps.jsonl never grows without limit
      const f = gapsFile();
      const size = await fs.promises.stat(f).then((s) => s.size).catch(() => 0);
      if (size > MAX_GAP_BYTES) await fs.promises.rename(f, f + '.1').catch(() => {});
      await fs.promises.appendFile(f, line, 'utf8');
    })
    .catch((err: unknown) => {
      if (!warned) {
        warned = true;
        console.warn('gaps: append failed', err instanceof Error ? err.message : String(err));
      }
    });
}

let summaryMemo: { key: string; at: number; rows: GapSummaryRow[] } | null = null;

/**
 * Top normalized questions with counts and reason breakdown, over the most
 * recent SUMMARY_TAIL_BYTES of the log.
 *
 * This used to readFileSync + JSON.parse the WHOLE file on every /api/diag hit
 * — linear in a file allowed to reach 5MB, i.e. seconds of fully-blocking event
 * loop while every concurrent chat stream waits (EP-SCALE-05 / EP-OBS-10). The
 * bound plus a 30s memo keyed on size+mtime makes the cost constant.
 * ponytail: tail window, so the summary is "recent gaps", not all-time. That is
 * what the diag page uses it for; an all-time count needs an aggregator, not a
 * bigger read.
 */
export function readGapSummary(limit = 20): GapSummaryRow[] {
  const file = gapsFile();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const key = `${stat.size}:${stat.mtimeMs}:${limit}`;
  if (summaryMemo && summaryMemo.key === key && Date.now() - summaryMemo.at < SUMMARY_TTL_MS) {
    return summaryMemo.rows;
  }
  let raw: string;
  try {
    raw = readTail(file, stat.size);
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
    // redact on READ as well: lines written before the sink was fixed are still
    // on disk, and this is the surface that publishes them
    const question = redactSecrets(e.normalizedQuestion).slice(0, MAX_QUESTION_CHARS);
    let row = byQuestion.get(question);
    if (!row) {
      row = { question, count: 0, reasons: {} };
      byQuestion.set(question, row);
    }
    row.count++;
    row.reasons[e.reason] = (row.reasons[e.reason] ?? 0) + 1;
  }
  const rows = [...byQuestion.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  summaryMemo = { key, at: Date.now(), rows };
  return rows;
}

/** Last SUMMARY_TAIL_BYTES of the file, minus the record the window cut in half. */
function readTail(file: string, size: number): string {
  if (size <= SUMMARY_TAIL_BYTES) return fs.readFileSync(file, 'utf8');
  const buf = Buffer.alloc(SUMMARY_TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, SUMMARY_TAIL_BYTES, size - SUMMARY_TAIL_BYTES);
  } finally {
    fs.closeSync(fd);
  }
  // the window starts mid-record (and mid-UTF8 sequence) — drop to the first \n
  const text = buf.toString('utf8');
  return text.slice(text.indexOf('\n') + 1);
}

/** @internal test-only; do not call from app code. */
export function resetGapSummaryCacheForTests(): void {
  summaryMemo = null;
}

/** @internal test-only; awaits the fire-and-forget append chain. */
export function flushGapsForTests(): Promise<void> {
  return appendQueue;
}
