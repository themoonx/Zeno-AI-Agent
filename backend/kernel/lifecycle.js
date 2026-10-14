// Lifecycle & ownership — deterministic teardown for everything the runtime
// creates. The core rule (from the audit): REGISTER TEARDOWN BEFORE you
// publish a live resource. A socket, a stream, a child process, a scheduled
// claim — the moment something can be observed by the outside world, its
// dispose function must already be registered.
//
// Usage:
//   const reg = createDisposalRegistry();
//   const socket = openSocket();
//   reg.register('socket', () => socket.close());   // BEFORE first send
//   ...
//   await reg.disposeAll();                          // reverse-order unwind
//
// withTeardown wraps a scope so a partial initialization (step 3 of 5 fails)
// still unwinds steps 1-2 instead of leaking.
export class LifecycleError extends Error {}

export function createDisposalRegistry({ label = 'scope' } = {}) {
  const entries = []; // { label, dispose }
  let disposed = false;

  return {
    label,
    get size() {
      return entries.length;
    },
    get disposed() {
      return disposed;
    },
    /** Register teardown for a resource. Must be called before the resource is published. */
    register(labelOrFn, maybeFn = null) {
      if (disposed) throw new LifecycleError(`${label}: register() after disposeAll() — refusing to leak`);
      const name = maybeFn ? String(labelOrFn) : labelOrFn?.name || 'resource';
      const dispose = maybeFn || labelOrFn;
      if (typeof dispose !== 'function') throw new LifecycleError(`${label}: teardown for "${name}" is not a function`);
      entries.push({ label: name, dispose });
    },
    /** Reverse-order unwind; errors collected, never thrown mid-unwind. */
    async disposeAll({ reason = 'normal' } = {}) {
      if (disposed) return [];
      disposed = true;
      const errors = [];
      while (entries.length) {
        const { label: name, dispose } = entries.pop();
        try {
          await dispose(reason);
        } catch (err) {
          errors.push(`${name}: ${err.message}`);
        }
      }
      return errors;
    },
  };
}

/**
 * Scope wrapper: run `fn(registry)`; whether it resolves, rejects, or the
 * caller aborts, everything registered inside is disposed. The fn's result or
 * error is returned after disposal. Abort support: pass an AbortSignal — when
 * it fires, the registry is disposed and `fn` is expected to notice via its
 * own signal wiring.
 */
export async function withTeardown(label, fn, { signal } = {}) {
  const registry = createDisposalRegistry({ label });
  if (signal) {
    if (signal.aborted) await registry.disposeAll({ reason: 'pre-aborted' });
    else signal.addEventListener('abort', () => registry.disposeAll({ reason: 'aborted' }), { once: true });
  }
  try {
    return await fn(registry);
  } finally {
    await registry.disposeAll({ reason: 'scope-exit' });
  }
}
