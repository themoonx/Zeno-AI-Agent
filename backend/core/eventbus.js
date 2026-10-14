// In-process pub/sub for live agent events and per-user notifications.
// Single-process deployments subscribe directly; a Redis adapter can be added
// behind this interface for multi-node setups (same publish/subscribe shape).
const listeners = new Map(); // key -> Set<fn>

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

export function publish(key, event) {
  const set = listeners.get(key);
  if (!set) return 0;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      /* a broken subscriber must not break publishers */
    }
  }
  return set.size;
}

export const topics = {
  userEvents: (userId) => `user:${userId}:events`,
  runEvents: (runId) => `run:${runId}:events`,
};
