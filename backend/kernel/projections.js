









export function projectMessages(events) {
  const messages = [];
  for (const ev of events) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'user/message':
        messages.push({ role: 'user', content: d.content || '', attachments: d.attachments || null, _seq: ev.seq });
        break;
      case 'assistant/attempt':
        messages.push({
          role: 'assistant',
          content: d.text || '',
          toolCalls: (d.toolCalls || []).map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })),
          _seq: ev.seq,
        });
        break;
      case 'tool/completed':
        messages.push({ role: 'tool', toolCallId: d.callId, name: d.tool, content: d.output || '', _seq: ev.seq });
        break;
      case 'assistant/message':
        if (d.text) messages.push({ role: 'assistant', content: d.text, _seq: ev.seq });
        break;
      case 'context/compacted':
        
        
        if (d.uptoEventSeq != null) {
          const kept = messages.filter((m) => m._seq != null && m._seq > d.uptoEventSeq);
          messages.length = 0;
          messages.push({ role: 'user', content: `[Conversation so far — summary of earlier messages]\n${d.summary}` }, ...kept);
        }
        break;
      default:
        break;
    }
  }
  return messages;
}

export function projectPlan(events) {
  let plan = null;
  for (const ev of events) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'plan/created':
        plan = { planId: ev.data.planId || d.planId, understanding: d.understanding || '', steps: d.steps || [], status: d.requiresApproval ? 'pending' : 'approved', completedSteps: 0 };
        break;
      case 'plan/approved':
        if (plan) plan.status = 'approved';
        break;
      case 'plan/rejected':
        if (plan) plan.status = 'rejected';
        break;
      case 'plan/progress':
        if (plan) plan.completedSteps = d.completedSteps ?? plan.completedSteps;
        break;
      case 'plan/finished':
        if (plan) plan.status = 'done';
        break;
      default:
        break;
    }
  }
  return plan;
}

export function projectToolActivity(events) {
  const calls = new Map(); 
  const order = [];
  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === 'agent/request') {
      const callId = d.callId;
      if (callId && !calls.has(callId)) {
        calls.set(callId, { callId, tool: d.tool, displayName: d.displayName, arguments: d.arguments, state: 'requested' });
        order.push(callId);
      }
    } else if (ev.type === 'tool/started') {
      if (!calls.has(d.callId)) {
        calls.set(d.callId, { callId: d.callId, tool: d.tool, displayName: d.displayName, arguments: d.arguments, state: 'running' });
        order.push(d.callId);
      } else {
        const c = calls.get(d.callId);
        c.state = 'running';
        c.sensitive = d.sensitive;
        c.autoApproved = d.autoApproved;
      }
    } else if (ev.type === 'tool/completed') {
      if (!calls.has(d.callId)) {
        calls.set(d.callId, { callId: d.callId, tool: d.tool, displayName: d.displayName, state: d.ok ? 'done' : d.denied ? 'denied' : 'failed' });
        order.push(d.callId);
      }
      const c = calls.get(d.callId);
      c.state = d.denied ? 'denied' : d.ok ? 'done' : 'failed';
      c.ok = !!d.ok;
      c.denied = !!d.denied;
      c.durationMs = d.durationMs;
      c.output = d.output;
      c.file = d.file;
    }
  }
  return order.map((id) => calls.get(id));
}

export function projectUsage(events) {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const ev of events) {
    if (ev.type === 'assistant/message' || ev.type === 'turn/end') {
      const u = ev.data?.usage;
      if (u) {
        promptTokens += u.promptTokens || 0;
        completionTokens += u.completionTokens || 0;
      }
    }
  }
  return { promptTokens, completionTokens };
}

export function projectSubagents(events) {
  const tasks = new Map();
  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === 'subagent/assigned') {
      tasks.set(d.subSessionId, { subSessionId: d.subSessionId, task: d.task, status: 'running' });
    } else if (ev.type === 'subagent/completed') {
      const t = tasks.get(d.subSessionId);
      if (t) {
        t.status = d.failed ? 'failed' : 'done';
        t.result = d.result;
        t.usage = d.usage;
      }
    }
  }
  return [...tasks.values()];
}

export function projectReviews(events) {
  const reviews = [];
  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === 'review/findings') reviews.push({ reviewId: ev.data.reviewId || d.reviewId, findings: d.findings || [], verdict: d.verdict || 'needs-attention', diffSummary: d.diffSummary });
    else if (ev.type === 'review/decided') {
      const last = reviews[reviews.length - 1];
      if (last) last.decision = d.decision;
    }
  }
  return reviews;
}


export function projectMessageRows(events) {
  const rows = [];
  for (const ev of events) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'user/message':
        rows.push({ role: 'user', content: d.content || '', attachments: d.displayAttachments || null, id: d.messageId, reasoning: null, status: 'complete' });
        break;
      case 'assistant/attempt':
        rows.push({ role: 'assistant', content: d.text || '', attachments: { kind: 'tool_step', toolCalls: d.toolCalls || [] }, reasoning: d.reasoning || null, id: d.messageId, status: 'complete' });
        break;
      case 'tool/completed':
        rows.push({ role: 'tool', content: d.output || '', attachments: { kind: 'tool_result', tool: d.tool, toolCallId: d.callId, ok: !!d.ok, denied: !!d.denied, ...(d.file ? { file: d.file } : {}), ...(d.displayName ? { displayName: d.displayName } : {}) }, id: d.messageId, status: 'complete' });
        break;
      case 'assistant/message':
        rows.push({ role: 'assistant', content: d.text || '', reasoning: d.reasoning || null, usage: d.usage, modelLabel: d.modelLabel, id: d.messageId, status: d.status || 'complete' });
        break;
      default:
        break;
    }
  }
  return rows;
}
