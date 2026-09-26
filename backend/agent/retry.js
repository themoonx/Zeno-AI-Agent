




import { classifyError, FAILURE_CLASSES } from '../decision/engine.js';

export { classifyError, FAILURE_CLASSES };

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



function retryPlan({ failureClass, attempt, maxAttempts, baseDelayMs = 500, maxDelayMs = 8000 }) {
  const RETRYABLE = new Set(['TRANSIENT', 'RATE_LIMIT', 'NETWORK', 'MODEL_FAILURE']);
  if (!RETRYABLE.has(failureClass)) return { action: 'abort', delayMs: 0 };
  if (attempt >= maxAttempts) return { action: 'escalate', delayMs: 0 };
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return { action: 'retry', delayMs: Math.round(exp * (0.7 + 0.6 * Math.random())) };
}
