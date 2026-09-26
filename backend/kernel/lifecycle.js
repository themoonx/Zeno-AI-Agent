














export class LifecycleError extends Error {}

export function createDisposalRegistry({ label = 'scope' } = {}) {
  const entries = []; 
  let disposed = false;

  return {
    label,
    get size() {
      return entries.length;
    },
    get disposed() {
      return disposed;
    },
    
    register(labelOrFn, maybeFn = null) {
      if (disposed) throw new LifecycleError(`${label}: register() after disposeAll() — refusing to leak`);
      const name = maybeFn ? String(labelOrFn) : labelOrFn?.name || 'resource';
      const dispose = maybeFn || labelOrFn;
      if (typeof dispose !== 'function') throw new LifecycleError(`${label}: teardown for "${name}" is not a function`);
      entries.push({ label: name, dispose });
    },
    
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
