// Retry intelligence (harness spec §22/§23): classify failures once, retry
// only the classes where a retry can plausibly succeed, back off exponentially
// with jitter, and never blind-loop. Used by the orchestrator around model
// calls; the capability executor keeps its own (correct) no-retry semantics —
// tool results are deterministic observations, not transient infra.
import { classifyError, FAILURE_CLASSES } from '../decision/engine.js';

export { classifyError, FAILURE_CLASSES };

/**
 * Run `fn` with bounded retry. `attemptWins` lets streaming callers veto a
 * retry after partial output has already been emitted (a retry would
 * duplicate deltas into the user's transcript).
 *
 * opts: {
 *   classify: (err) => failureClass,   // default classifyError
 *   plan:    (info) => { action, delayMs },  // default: decision-engine rules
 *   attempts: number,                  // retry budget (default 2)
 *   canRetry: () => boolean,           // e.g. "no deltas emitted yet"
 *   onRetry: (info) => void,           // telemetry hook
 *   signal,                            // abort propagates immediately
 * }
 */
export async function withModelRetry(fn, opts = {}) {
  const attempts = Math.max(0, opts.attempts ?? 2);
  const classify = opts.classify || classifyError;
  const plan = opts.plan || (({ failureClass, attempt }) => retryPlan({ failureClass, attempt, maxAttempts: attempts }));
  let lastErr = null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') throw err;
      if (opts.signal?.aborted) throw err;
      const failureClass = classify(err);
      const step = plan({ failureClass, attempt, maxAttempts: attempts });
      const vetoed = typeof opts.canRetry === 'function' && !opts.canRetry({ failureClass, attempt });
      if (step.action !== 'retry' || vetoed) throw err;
      opts.onRetry?.({ attempt: attempt + 1, failureClass, delayMs: step.delayMs, error: String(err?.message || err).slice(0, 200) });
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, step.delayMs);
        if (opts.signal) {
          const abort = () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          if (opts.signal.aborted) abort();
          else opts.signal.addEventListener('abort', abort, { once: true });
        }
      });
    }
  }
}

// Default back-off policy (mirrors the decision engine's retryPlan; kept
// import-free here so the retry util stays usable in isolation).
function retryPlan({ failureClass, attempt, maxAttempts, baseDelayMs = 500, maxDelayMs = 8000 }) {
  const RETRYABLE = new Set(['TRANSIENT', 'RATE_LIMIT', 'NETWORK', 'MODEL_FAILURE']);
  if (!RETRYABLE.has(failureClass)) return { action: 'abort', delayMs: 0 };
  if (attempt >= maxAttempts) return { action: 'escalate', delayMs: 0 };
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return { action: 'retry', delayMs: Math.round(exp * (0.7 + 0.6 * Math.random())) };
}
