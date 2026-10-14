// Reconstruction invariant — the DeepSeek-style runtime guarantee:
//
//   the messages sent to the model must deterministically match the messages
//   derived from the persisted session state.
//
// `reconstructTranscript` derives the model transcript purely from session
// events (projectMessages). The orchestrator checks its live transcript
// against the reconstruction at turn start (before resuming an existing
// session) and before finalizing each assistant message. Any desync — a
// missed event, an out-of-order write, a hand-built transcript — fails LOUDLY
// with a ReconstructionError instead of silently drifting.
import { projectMessages } from './projections.js';

export class ReconstructionError extends Error {
  constructor(sessionId, details) {
    super(`Reconstruction desync on session ${sessionId}: ${details}`);
    this.code = 'reconstruction_desync';
    this.sessionId = sessionId;
    this.details = details;
  }
}

/** Reconstruct the model-facing transcript (excluding system prompts) from the session event log. */
export function reconstructTranscript(kernel, sessionId) {
  const events = kernel.replay(sessionId);
  return projectMessages(events);
}

// Canonical form: strip projection-only fields, normalize images (persisted
// file references differ from in-memory base64), stable JSON.
function canonical(messages) {
  const norm = (m) => {
    const out = { role: m.role, content: m.content ?? '' };
    if (m.toolCallId !== undefined) out.toolCallId = m.toolCallId;
    if (m.name !== undefined) out.name = m.name;
    if (Array.isArray(m.toolCalls)) out.toolCalls = m.toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.arguments }));
    if (Array.isArray(m.images)) out.images = m.images.map((i) => ({ mime: i.mime, bytes: i.base64?.length ?? 0 }));
    return out;
  };
  return JSON.stringify(messages.map(norm));
}

/**
 * Compare the live transcript the orchestrator built with the reconstruction
 * from the event log. `live` must exclude system prompts. Returns a diff
 * summary on mismatch (first divergence point).
 */
export function checkInvariant(sessionId, live, reconstructed) {
  const a = canonical(live);
  const b = canonical(reconstructed);
  if (a === b) return null;
  let divergeAt = -1;
  const la = JSON.parse(a);
  const lb = JSON.parse(b);
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (JSON.stringify(la[i]) !== JSON.stringify(lb[i])) {
      divergeAt = i;
      break;
    }
  }
  const summary = `live=${la.length} msgs, reconstructed=${lb.length} msgs, first divergence at index ${divergeAt}` +
    (divergeAt >= 0
      ? ` (live.role=${la[divergeAt]?.role ?? '∅'}, replayed.role=${lb[divergeAt]?.role ?? '∅'}; live=${JSON.stringify(la[divergeAt]).slice(0, 220)}, replayed=${JSON.stringify(lb[divergeAt]).slice(0, 220)})`
      : '');
  throw new ReconstructionError(sessionId, summary);
}
