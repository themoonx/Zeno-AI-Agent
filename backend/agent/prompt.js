




import { budgetCharsFor } from './context.js';

const DROPPABLE_BELOW = 80; 

export function createPromptRegistry() {
  const contributors = new Map();

    function register({ id, priority, section }) {
    if (!id || typeof section !== 'function') throw new Error(`prompt contributor "${id}" is invalid`);
    contributors.set(id, { id, priority: Number(priority) || 50, section });
  }

  function unregister(id) {
    contributors.delete(id);
  }

    function assemble(ctx) {
    const budget = ctx.budget ?? budgetCharsFor(ctx.modelRow);
    const built = [];
    for (const c of contributors.values()) {
      let text = null;
      try {
        text = c.section(ctx);
      } catch {
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

    function inspect() {
    return [...contributors.values()].sort((a, b) => b.priority - a.priority).map((c) => ({ id: c.id, priority: c.priority }));
  }

  return { register, unregister, assemble, inspect };
}
