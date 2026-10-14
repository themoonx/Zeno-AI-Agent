// Prompt assembly registry — the composable replacement for one hard-coded
// system prompt. Subsystems register CONTRIBUTORS; each returns a section
// (string) or null. Assembly is deterministic: contributors are sorted by
// priority, low-priority sections are dropped first under the budget, and the
// result is inspectable (see inspect()).
import { budgetCharsFor } from './context.js';

const DROPPABLE_BELOW = 80; // sections below this priority yield to the budget

export function createPromptRegistry() {
  const contributors = new Map();

  /** register({ id, priority, section(ctx) → string|null }) */
  function register({ id, priority, section }) {
    if (!id || typeof section !== 'function') throw new Error(`prompt contributor "${id}" is invalid`);
    contributors.set(id, { id, priority: Number(priority) || 50, section });
  }

  function unregister(id) {
    contributors.delete(id);
  }

  /** Build the system prompt. ctx carries everything sections may need. */
  function assemble(ctx) {
    const budget = ctx.budget ?? budgetCharsFor(ctx.modelRow);
    const built = [];
    for (const c of contributors.values()) {
      let text = null;
      try {
        text = c.section(ctx);
      } catch {
        /* a broken contributor must not break the prompt */
      }
      if (text) built.push({ id: c.id, priority: c.priority, text });
    }
    built.sort((a, b) => b.priority - a.priority);
    let total = 0;
    const dropped = [];
    const kept = [];
    for (const s of built) {
      if (s.priority < DROPPABLE_BELOW && total + s.text.length > budget) {
        dropped.push(s.id);
        continue;
      }
      kept.push(s.text);
      total += s.text.length;
    }
    ctx._droppedSections = dropped;
    return kept.join('\n\n');
  }

  /** Deterministic introspection: ids + priorities (no content). */
  function inspect() {
    return [...contributors.values()].sort((a, b) => b.priority - a.priority).map((c) => ({ id: c.id, priority: c.priority }));
  }

  return { register, unregister, assemble, inspect };
}
