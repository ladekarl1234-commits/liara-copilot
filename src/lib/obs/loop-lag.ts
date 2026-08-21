// Event-loop delay signal (EP-SCALE-04).
//
// Retrieval, fusion and coverage are all synchronous CPU on the single event
// loop, so one chat request stalls every other in-flight SSE stream — and there
// was no signal for it anywhere, which is why the bottleneck is invisible in
// production. This is the measurement the finding asks for BEFORE any worker
// pool: `monitorEventLoopDelay` is a libuv-side histogram (no JS timer, no
// per-tick work), so it can simply stay on.

import { monitorEventLoopDelay } from 'node:perf_hooks';

const WINDOW_MS = 60_000;

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
let windowStart = Date.now();

/**
 * p99 event-loop delay in ms over a rolling ~1-minute window.
 * ponytail: reset-on-read window rather than real time-series buckets — a
 * proper exporter (prom-client's `nodejs_eventloop_lag_p99`) is the upgrade if
 * this number ever needs to be graphed rather than eyeballed per request.
 */
export function eventLoopLagP99Ms(): number {
  const p99Ms = histogram.percentile(99) / 1e6; // percentile() is nanoseconds
  if (Date.now() - windowStart > WINDOW_MS) {
    histogram.reset();
    windowStart = Date.now();
  }
  return Math.round(p99Ms * 100) / 100;
}
