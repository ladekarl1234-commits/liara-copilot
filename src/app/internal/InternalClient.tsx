'use client';

// Dev-gated internal diagnostics — NOT the public product. Renders the measured
// evidence from /api/diag (index status, provider/model usage, latest retrieval
// eval, and the live per-answer search trace). Returns 404 in prod unless
// DIAG_ENABLED=on. Only measured values are shown; no demo statistics.

import { useEffect, useState } from 'react';

interface Diag {
  provider?: { name: string; configured: boolean; fastModel: string; smartModel: string; embeddings: string | null; voiceConfigured: boolean };
  index?: { chunkCount?: number; fileCount?: number; builtAt?: string; docsCommit?: string; anchorCoverage?: number; embeddedCount?: number; error?: string };
  eval?: { file?: string; total?: number; hit1?: number; hit3?: number; hit5?: number; mrr?: number; gateAccuracy?: number } | null;
  traces?: Trace[];
  gaps?: unknown;
}
interface Trace {
  requestId: string;
  ts: string;
  message: string;
  retrieval?: { queries: string[]; confidence: string; chunks: { id: string; score: number; url: string }[]; latencyMs: number };
  modelRoute?: string;
  actualModel?: string;
  usage?: { inputTokens: number; outputTokens: number };
  totalLatencyMs?: number;
  error?: string;
}

const pct = (n?: number) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
const num = (n?: number) => (n == null ? '—' : n.toLocaleString('en-US'));

export default function InternalClient() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'disabled' | 'error'>('loading');

  const load = () => {
    fetch('/api/diag')
      .then((r) => {
        if (r.status === 404) { setStatus('disabled'); return null; }
        if (!r.ok) { setStatus('error'); return null; }
        return r.json();
      })
      .then((d) => { if (d) { setDiag(d); setStatus('ok'); } })
      .catch(() => setStatus('error'));
  };

  useEffect(load, []);

  if (status === 'loading') return <Shell><p>در حال بارگذاری…</p></Shell>;
  if (status === 'disabled')
    return <Shell><p>Diagnostics are disabled. Set <code>DIAG_ENABLED=on</code> to enable this page.</p></Shell>;
  if (status === 'error' || !diag) return <Shell><p>Failed to load diagnostics.</p></Shell>;

  const idx = diag.index ?? {};
  const p = diag.provider;
  const ev = diag.eval;

  return (
    <Shell onRefresh={load}>
      <section className="grid">
        <Stat label="Docs indexed" value={num(idx.fileCount)} />
        <Stat label="Chunks" value={num(idx.chunkCount)} />
        <Stat label="Embedded chunks" value={num(idx.embeddedCount)} />
        <Stat label="Anchor coverage" value={pct(idx.anchorCoverage)} />
        <Stat label="Source commit" value={idx.docsCommit ? idx.docsCommit.slice(0, 10) : '—'} mono />
        <Stat label="Built at" value={idx.builtAt ? new Date(idx.builtAt).toISOString().slice(0, 16).replace('T', ' ') : '—'} />
      </section>

      <h2>Provider</h2>
      <section className="grid">
        <Stat label="LLM provider" value={p?.name ?? '—'} />
        <Stat label="Configured" value={p?.configured ? 'yes' : 'no (keyless)'} />
        <Stat label="Fast model" value={p?.fastModel ?? '—'} mono />
        <Stat label="Smart model" value={p?.smartModel ?? '—'} mono />
        <Stat label="Embeddings" value={p?.embeddings ?? 'off (lexical-only)'} mono />
        <Stat label="Voice (STT)" value={p?.voiceConfigured ? 'configured' : 'not configured'} />
      </section>

      <h2>Retrieval eval {ev?.file ? <span className="mut">· {ev.file}</span> : null}</h2>
      {ev ? (
        <section className="grid">
          <Stat label="Cases" value={num(ev.total)} />
          <Stat label="Recall@1" value={pct(ev.hit1)} />
          <Stat label="Recall@3" value={pct(ev.hit3)} />
          <Stat label="Recall@5" value={pct(ev.hit5)} />
          <Stat label="MRR" value={ev.mrr != null ? ev.mrr.toFixed(3) : '—'} />
          <Stat label="Gate accuracy" value={pct(ev.gateAccuracy)} />
        </section>
      ) : (
        <p className="mut">No eval result found. Run <code>npm run evaluate:retrieval</code>.</p>
      )}

      <h2>Search traces <span className="mut">(last {diag.traces?.length ?? 0})</span></h2>
      <div className="traces">
        {(diag.traces ?? []).map((t) => <TraceRow key={t.requestId} t={t} />)}
        {!diag.traces?.length && <p className="mut">No traces yet — ask a question on the main page.</p>}
      </div>
    </Shell>
  );
}

function TraceRow({ t }: { t: Trace }) {
  return (
    <details className="trace">
      <summary>
        <span className={`badge badge-${t.retrieval?.confidence ?? 'na'}`}>{t.retrieval?.confidence ?? (t.error ? 'error' : '—')}</span>
        <span className="trace-msg" dir="auto">{t.message}</span>
        <span className="mut">{t.totalLatencyMs != null ? `${t.totalLatencyMs}ms` : ''}</span>
      </summary>
      <div className="trace-body">
        <div><b>queries:</b> {t.retrieval?.queries.join(' · ') ?? '—'}</div>
        <div><b>model:</b> {t.modelRoute ?? '—'}{t.actualModel ? ` → ${t.actualModel}` : ''}</div>
        <div><b>tokens:</b> in {t.usage?.inputTokens ?? '—'} / out {t.usage?.outputTokens ?? '—'} · retrieval {t.retrieval?.latencyMs ?? '—'}ms</div>
        {t.error && <div className="err"><b>error:</b> {t.error}</div>}
        <ol>
          {(t.retrieval?.chunks ?? []).slice(0, 8).map((c) => (
            <li key={c.id}><a href={c.url} target="_blank" rel="noreferrer">{c.url.replace('https://docs.liara.ir', '')}</a> <span className="mut">({c.score.toFixed(2)})</span></li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}

function Shell({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => void }) {
  return (
    <main className="internal" dir="ltr">
      <header className="internal-head">
        <div>
          <h1>Liara Copilot · Internal</h1>
          <p className="mut">Diagnostics — not the public product. Measured values only.</p>
        </div>
        {onRefresh && <button type="button" className="chip" onClick={onRefresh}>Refresh</button>}
      </header>
      {children}
    </main>
  );
}
