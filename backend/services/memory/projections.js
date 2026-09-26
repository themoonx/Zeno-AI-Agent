



import { logger } from '../../core/logger.js';

const log = logger('memory-projections');

export function projectStructuredMemory(events) {
  const goals = [];
  const tasks = [];
  const decisions = [];

  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === 'plan/created' && d.steps?.length) {
      goals.push({ content: `Goal: ${d.understanding || d.steps.map((s) => s.title).join(' → ')}`.slice(0, 400), importance: 0.6, tags: ['goal'] });
      for (const s of d.steps) {
        tasks.push({ content: `Task: ${s.title}${s.detail ? ` — ${s.detail}` : ''}`.slice(0, 400), importance: 0.5, tags: ['task'] });
      }
    } else if (ev.type === 'plan/approved') {
      decisions.push({ content: 'Decision: plan approved and executed', importance: 0.5, tags: ['decision'] });
    } else if (ev.type === 'plan/rejected') {
      decisions.push({ content: 'Decision: plan rejected — no actions taken', importance: 0.5, tags: ['decision'] });
    } else if (ev.type === 'permission/decided' && d.decision === 'approved' && d.tool !== 'plan') {
      decisions.push({ content: `Decision: approved ${d.displayName || d.tool}`, importance: 0.35, tags: ['decision', 'permission'] });
    } else if (ev.type === 'review/findings' && d.verdict) {
      decisions.push({ content: `Review verdict: ${d.verdict}${d.findings?.length ? ` (${d.findings.length} findings)` : ''}`, importance: 0.45, tags: ['decision', 'review'] });
    } else if (ev.type === 'subagent/completed' && d.result) {
      tasks.push({ content: `Subagent result: ${String(d.result).slice(0, 300)}`, importance: 0.4, tags: ['task', 'subagent'] });
    }
  }

  return { goals, tasks, decisions };
}


export async function projectSessionMemory({ memory, repos, userId, sessionId, conversationId = null, projectId = null }) {
  try {
    const events = repos.sessions.listEvents(sessionId);
    const { goals, tasks, decisions } = projectStructuredMemory(events);
    let stored = 0;
    for (const entry of [...goals.slice(0, 3), ...decisions.slice(0, 5), ...tasks.slice(0, 8)]) {
      const result = await memory.remember({
        userId,
        kind: entry.tags.includes('goal') ? 'fact' : entry.tags.includes('decision') ? 'fact' : 'fact',
        content: entry.content,
        importance: entry.importance,
        tags: entry.tags,
        projectId,
        conversationId,
        source: 'session-projection',
      });
      if (result.action === 'stored' || result.action === 'superseded') stored++;
    }
    if (stored) log.info(`session ${sessionId}: ${stored} structured memories stored`);
    return stored;
  } catch (err) {
    log.warn(`structured memory projection failed: ${err.message}`);
    return 0;
  }
}