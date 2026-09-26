



export function toChatFrame(event) {
  const { type, data } = event;
  switch (type) {
    case 'output/delta': return { type: 'delta', text: data.text };
    case 'output/reasoning': return { type: 'reasoning', text: data.text };
    case 'phase/changed':
      
      
      if (['thinking', 'planning', 'routing', 'researching', 'executing', 'verifying'].includes(data.phase)) {
        return { type: 'status', phase: data.phase, label: data.detail || null };
      }
      return null;
    case 'user/message': {
      if (!data.messageRow) return null;
      const row = data.messageRow;
      return { type: 'user_message', message: { ...row, images: undefined } };
    }
    case 'plan/created': return { type: 'plan', phase: 'ready', planId: data.planId, understanding: data.understanding, steps: data.steps, requiresApproval: data.requiresApproval };
    case 'plan/approved': return { type: 'plan', phase: 'approved', planId: data.planId };
    case 'plan/rejected': return { type: 'plan', phase: 'denied', planId: data.planId };
    case 'plan/progress': return { type: 'plan', phase: 'progress', planId: data.planId, completedSteps: data.completedSteps };
    case 'plan/finished': return { type: 'plan', phase: 'finished', planId: data.planId };
    case 'permission/requested': return { type: 'approval_required', approvalId: data.approvalId, tool: data.tool, displayName: data.displayName, summary: data.summary, payload: data.payload };
    case 'permission/decided': return { type: 'activity', kind: 'approval_decided', tool: data.tool, displayName: data.displayName, decision: data.decision };
    case 'tool/started': return { type: 'activity', kind: 'tool_call', callId: data.callId, tool: data.tool, displayName: data.displayName, arguments: data.arguments, sensitive: data.sensitive, autoApproved: data.autoApproved };
    case 'tool/completed': return { type: 'activity', kind: 'tool_result', callId: data.callId, tool: data.tool, displayName: data.displayName, ok: data.ok, denied: data.denied, durationMs: data.durationMs, output: data.output, file: data.file };
    case 'snapshot/captured': return { type: 'activity', kind: 'snapshot', action: 'captured', snapshotId: data.snapshotId, label: data.label, files: data.files };
    case 'snapshot/restored': return { type: 'activity', kind: 'snapshot', action: data.direction || 'restored', snapshotId: data.snapshotId };
    case 'subagent/assigned': return { type: 'activity', kind: 'subagent', state: 'assigned', subSessionId: data.subSessionId, task: data.task };
    case 'subagent/completed': return { type: 'activity', kind: 'subagent', state: data.failed ? 'failed' : 'done', subSessionId: data.subSessionId, result: data.result };
    case 'review/findings': return { type: 'activity', kind: 'review', findings: data.findings, verdict: data.verdict };
    case 'verification/completed': return { type: 'activity', kind: 'verification', level: data.level, ok: data.ok, issues: data.issues, confidence: data.confidence, checker: data.checker, revised: !!data.revised };
    default: return null;
  }
}
