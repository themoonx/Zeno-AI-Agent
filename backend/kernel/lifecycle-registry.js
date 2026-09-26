




import { createDisposalRegistry } from './lifecycle.js';

const registries = new Map(); 

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