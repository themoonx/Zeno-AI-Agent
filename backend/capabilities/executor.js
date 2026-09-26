








import { config } from '../core/config.js';

const OUTPUT_CAP = () => config.agent.maxToolOutputChars;
const PREVIEW_CHARS = 16_000;

const FILE_TOOLS = new Set(['file_read', 'file_write', 'file_edit', 'file_delete', 'local_read', 'local_write', 'local_edit', 'local_delete']);

export function filePreviewFor(toolName, args, result) {
  if (!FILE_TOOLS.has(toolName) || !args) return null;
  const filePath = args.path || (result && result.path);
  if (!filePath) return null;
  const preview = {
    tool: toolName,
    path: filePath,
    verb: toolName.endsWith('_write') ? 'wrote' : toolName.endsWith('_edit') ? 'edited' : toolName.endsWith('_delete') ? 'deleted' : 'read',
    language: languageFor(filePath),
    workspace: toolName.startsWith('file_'),
  };
  if (result && typeof result === 'object') {
    if (result.preview && typeof result.preview.content === 'string') {
      preview.content = result.preview.content;
      preview.truncated = !!result.preview.truncated;
    } else if (typeof result.content === 'string') {
      preview.content = result.content.slice(0, PREVIEW_CHARS);
      preview.truncated = !!result.truncated || result.content.length > PREVIEW_CHARS;
    }
    if (result.created != null) preview.created = !!result.created;
    if (result.size != null) preview.size = result.size;
    if (result.replacements != null) preview.replacements = result.replacements;
  }
  return preview;
}

function languageFor(p) {
  const ext = String(p).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return (
    {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
      json: 'json', md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
      css: 'css', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml',
      toml: 'ini', ini: 'ini', env: 'ini', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
      txt: 'text', log: 'text', csv: 'text',
    }[ext] || 'text'
  );
}

export function createCapabilityExecutor({ repos, approvals, audit, policy, snapshots, telemetry }) {
  
  async function execute({ tool, args, callId, userId, runId, sessionId = null, scopeKey = null, conversationId = null, mode = 'ask', signal, emit, memory }) {
    if (!tool) {
      const output = JSON.stringify({ ok: false, error: 'Unknown capability' });
      emit?.('tool/completed', { callId, tool: 'unknown', ok: false, output });
      return { ok: false, output };
    }

    
    const verdict = await policy.evaluate({ userId, tool, args, mode });
    telemetry?.permissionDecision({ userId, sessionId, runId, tool: tool.name, decision: verdict.decision, reason: verdict.reason });
    if (verdict.decision === 'deny') {
      const output = JSON.stringify({ ok: false, error: `Blocked by permission policy (${verdict.reason}). Do not retry; tell the user.` });
      emit?.('tool/completed', { callId, tool: tool.name, displayName: tool.displayName, ok: false, denied: true, policyDenied: true, output });
      return { ok: false, denied: true, output };
    }

    
    if (verdict.decision === 'ask') {
      const hasStanding = repos.runs.hasStanding(runId, tool.name) || (!tool.connectorId && !tool.pluginId && repos.runs.hasStandingScope(userId, scopeKey, tool.name));
      if (!hasStanding) {
        repos.runs.updateRun(runId, { status: 'waiting_approval' });
        emit?.('phase/changed', { phase: 'waiting_approval' });
        const approval = approvals.request({ runId, userId, tool, args, meta: conversationId ? { conversationId } : {} });
        emit?.('permission/requested', { approvalId: approval.approvalId, tool: tool.name, displayName: tool.displayName, summary: approval.summary, payload: args });
        const decision = await approval.promise;
        emit?.('permission/decided', { tool: tool.name, displayName: tool.displayName, decision, approvalId: approval.approvalId });
        repos.runs.updateRun(runId, { status: 'running' });
        if (decision !== 'approved') {
          const output = 'The human DENIED this action. Do not retry it; choose another approach and tell the user.';
          emit?.('tool/completed', { callId, tool: tool.name, displayName: tool.displayName, ok: false, denied: true, output });
          return { ok: false, denied: true, output };
        }
      }
    }

    
    let snapshotId = null;
    if (snapshots?.shouldCapture(tool, args)) {
      snapshotId = await snapshots.captureBefore(userId, { sessionId, runId, tool: tool.name, args, emit });
    }

    
    emit?.('tool/started', { callId, tool: tool.name, displayName: tool.displayName, arguments: scrubArgs(tool, args), sensitive: !!tool.sensitive, autoApproved: verdict.decision === 'allow' && !!tool.sensitive });
    const started = Date.now();
    try {
      const timeoutSignal = AbortSignal.any?.([signal, AbortSignal.timeout(tool.timeoutMs || config.agent.toolTimeoutMs)].filter(Boolean)) || signal || AbortSignal.timeout(config.agent.toolTimeoutMs);
      let result = await tool.execute(args, { userId, runId, signal: timeoutSignal, memory });

      
      result = applyHooks(tool, result, { userId });
      
      result = scrubResult(result);

      let output = JSON.stringify(result, null, 1);
      if (output.length > OUTPUT_CAP()) {
        output = output.slice(0, OUTPUT_CAP()) + '\n[output truncated]';
        emit?.('tool/truncated', { callId, tool: tool.name, bytes: output.length });
      }
      const file = filePreviewFor(tool.name, args, result);
      const durationMs = Date.now() - started;
      
      
      if (snapshotId && sessionId) snapshots.recordCheckpoint(sessionId, snapshotId);
      emit?.('tool/completed', { callId, tool: tool.name, displayName: tool.displayName, ok: true, durationMs, output, file, snapshotId });
      telemetry?.toolExec({ userId, sessionId, runId, tool: tool.name, ok: true, durationMs, callId });
      return { ok: true, output, file, displayName: tool.displayName, snapshotId };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const output = JSON.stringify({ ok: false, error: err.message });
      const durationMs = Date.now() - started;
      emit?.('tool/completed', { callId, tool: tool.name, displayName: tool.displayName, ok: false, durationMs, output });
      telemetry?.toolExec({ userId, sessionId, runId, tool: tool.name, ok: false, durationMs, callId, error: err.message.slice(0, 200) });
      return { ok: false, output };
    }
  }

  
  
  function scrubArgs(tool, args) {
    if (!args) return args;
    if (tool?.name === 'http_request' && args.headers && typeof args.headers === 'object') {
      const REDACT = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|api-key)$/i;
      const headers = {};
      for (const [k, v] of Object.entries(args.headers)) {
        headers[k] = REDACT.test(k) ? '[redacted]' : v;
      }
      return { ...args, headers };
    }
    return args;
  }

  
  
  function scrubResult(result) {
    if (result && typeof result === 'object' && result.headers && typeof result.headers === 'object') {
      const REDACT = /^(authorization|www-authenticate|proxy-authenticate|set-cookie|x-api-key|x-auth-token)$/i;
      const headers = {};
      for (const [k, v] of Object.entries(result.headers)) {
        headers[k] = REDACT.test(k) ? '[redacted]' : v;
      }
      return { ...result, headers };
    }
    return result;
  }

  
  
  function applyHooks(tool, result, { userId }) {
    const hooks = Array.isArray(tool.hooks) ? tool.hooks : [];
    if (!hooks.length) return result;
    let out = result;
    for (const hook of hooks) {
      if (!hook?.redact?.pattern) continue;
      const re = safeRegex(hook.redact.pattern, hook.redact.flags || 'g');
      if (!re) continue;
      const replace = hook.redact.replace ?? '[redacted]';
      try {
        if (typeof out?.content === 'string') out = { ...out, content: out.content.replace(re, replace) };
        else if (typeof out?.stdout === 'string') out = { ...out, stdout: out.stdout.replace(re, replace) };
      } catch {
        
      }
    }
    return out;
  }

  function safeRegex(pattern, flags) {
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  return { execute, filePreviewFor };
}
