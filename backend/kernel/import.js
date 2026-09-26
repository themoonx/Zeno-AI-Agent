








const LEGACY_TYPE_MAP = {
  'agent.started': 'turn/start',
  'phase.changed': 'phase/changed',
  'plan.created': 'plan/created',
  'plan.approved': 'plan/approved',
  'plan.rejected': 'plan/rejected',
  'plan.progress': 'plan/progress',
  'plan.finished': 'plan/finished',
  'permission.requested': 'permission/requested',
  'permission.decided': 'permission/decided',
  'tool.started': 'tool/started',
  'tool.completed': 'tool/completed',
  'agent.completed': 'assistant/message',
  'agent.failed': 'session/failed',
  'agent.interrupted': 'turn/aborted',
  
};

export function importLegacyHistory({ repos, kernel, log }) {
  let conversations = 0;
  let runs = 0;

  
  for (const conv of repos.chat.listAllConversationHeaders()) {
    if (repos.sessions.latestForConversation(conv.id)) continue;
    const messages = repos.chat.listMessages(conv.id, { limit: 5000 });
    const session = kernel.create({ userId: conv.user_id ?? conv.userId, kind: 'chat', conversationId: conv.id });
    conversations++;
    for (const m of messages) {
      const att = m.attachments && !Array.isArray(m.attachments) ? m.attachments : null;
      if (m.role === 'user') {
        kernel.append(session.id, conv.user_id, 'user/message', {
          content: m.content,
          messageId: m.id,
          displayAttachments: Array.isArray(m.attachments) ? m.attachments : null,
        });
      } else if (m.role === 'assistant' && att?.kind === 'tool_step') {
        kernel.append(session.id, conv.user_id, 'assistant/attempt', { text: m.content, reasoning: m.reasoning || '', toolCalls: att.toolCalls || [], messageId: m.id });
      } else if (m.role === 'tool' && att) {
        kernel.append(session.id, conv.user_id, 'tool/completed', {
          callId: att.toolCallId, tool: att.tool, displayName: att.displayName,
          ok: att.ok !== false, denied: !!att.denied, output: m.content, file: att.file,
        });
      } else if (m.role === 'assistant') {
        kernel.append(session.id, conv.user_id, 'assistant/message', {
          text: m.content, reasoning: m.reasoning, usage: m.usage, modelLabel: m.modelLabel, messageId: m.id, status: m.status,
        });
      }
    }
    repos.sessions.setStatus(session.id, 'ended');
  }

  
  for (const run of repos.runs.listRunsWithLegacyEvents()) {
    if (repos.sessions.activeForRun(run.id)) continue;
    const session = kernel.create({ userId: run.userId, kind: run.kind === 'chat' ? 'chat' : 'task', runId: run.id, conversationId: run.conversationId });
    runs++;
    for (const ev of repos.runs.listEvents(run.id)) {
      const type = LEGACY_TYPE_MAP[ev.type];
      if (!type) continue; 
      let data = ev.data || {};
      if (type === 'assistant/message' && data?.result != null) {
        data = { text: data.result, usage: data.usage };
      }
      if (type === 'turn/start') data = { ...data, runId: run.id };
      kernel.append(session.id, run.userId, type, data);
    }
    const runRow = repos.runs.getRunRaw(run.id);
    repos.sessions.setStatus(session.id, runRow?.status === 'failed' ? 'failed' : runRow?.status === 'cancelled' ? 'stopped' : 'ended');
  }

  if (conversations || runs) log.info(`kernel import: ${conversations} conversations, ${runs} runs → sessions`);
  return { conversations, runs };
}
