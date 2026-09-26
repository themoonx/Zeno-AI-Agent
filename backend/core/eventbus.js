


const listeners = new Map(); 

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
      
    }
  }
  return set.size;
}

export const topics = {
  userEvents: (userId) => `user:${userId}:events`,
  runEvents: (runId) => `run:${runId}:events`,
};
