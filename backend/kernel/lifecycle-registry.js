// Session-scoped disposal registries. Every session gets one; anything it
// creates that outlives a single function call (streams, subagent sessions,
// relays, timers) registers teardown here BEFORE being published. Stop uses
// this to unwind deterministically; normal turn ends dispose turn-scoped
// scopes on their own.
import { createDisposalRegistry } from './lifecycle.js';

const registries = new Map(); // sessionId -> DisposalRegistry

export function getDisposals(sessionId) {
  if (!sessionId) return null;
  let reg = registries.get(sessionId);
  if (!reg) {
    reg = createDisposalRegistry({ label: `session:${sessionId}` });
    registries.set(sessionId, reg);
  }
  return reg;
}

export async function disposeSession(sessionId, reason = 'session-end') {
  const reg = registries.get(sessionId);
  if (!reg) return [];
  const errors = await reg.disposeAll({ reason });
  registries.delete(sessionId);
  return errors;
}