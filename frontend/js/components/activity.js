


import { h } from '../ui.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { fileTypeFor } from '../filetypes.js';
import { openFilePreview } from './file-preview.js';



const TOOL_VERBS = {
  web_search: { run: 'Searching the web', done: 'Searched the web', label: 'Search', icon: 'globe' },
  browser_read: { run: 'Reading page', done: 'Read page', label: 'Read Page', icon: 'globe' },
  http_request: { run: 'Requesting', done: 'Requested', label: 'HTTP Request', icon: 'external' },
  file_read: { run: 'Reading', done: 'Read', label: 'Read File', icon: 'file', file: 'read' },
  file_list: { run: 'Listing files', done: 'Listed files', label: 'List Files', icon: 'folderOpen' },
  file_write: { run: 'Writing', done: 'Written', label: 'Write File', icon: 'edit', file: 'write' },
  file_edit: { run: 'Editing', done: 'Edited', label: 'Edit File', icon: 'edit', file: 'edit' },
  file_delete: { run: 'Deleting', done: 'Deleted', label: 'Delete File', icon: 'trash', file: 'delete' },
  local_read: { run: 'Reading', done: 'Read', label: 'Read Local File', icon: 'desktop', file: 'read' },
  local_list: { run: 'Listing', done: 'Listed', label: 'List Local Directory', icon: 'desktop' },
  local_write: { run: 'Writing', done: 'Written', label: 'Write Local File', icon: 'desktop', file: 'write' },
  local_edit: { run: 'Editing', done: 'Edited', label: 'Edit Local File', icon: 'desktop', file: 'edit' },
  local_delete: { run: 'Deleting', done: 'Deleted', label: 'Delete Local File', icon: 'desktop', file: 'delete' },
  terminal: { run: 'Running command', done: 'Ran command', label: 'Terminal', icon: 'terminal' },
  code_exec: { run: 'Executing code', done: 'Executed code', label: 'Code Execution', icon: 'code' },
  memory_search: { run: 'Recalling', done: 'Recalled', label: 'Memory Search', icon: 'brain' },
  memory_write: { run: 'Remembering', done: 'Remembered', label: 'Memory Write', icon: 'brain' },
  skill_load: { run: 'Loading skill', done: 'Loaded skill', label: 'Load Skill', icon: 'book' },
  plan: { run: 'Planning', done: 'Planned', label: 'Plan', icon: 'plan' },
};

function verbsFor(tool) {
  return TOOL_VERBS[tool] || { run: 'Calling', done: 'Called', icon: 'zap' };
}



function fileRefFrom(tool, att) {
  const f = att?.file;
  if (f?.path) {
    const action = f.verb === 'wrote' ? (f.created ? 'wrote_new' : 'wrote') : f.verb === 'edited' ? 'edited' : f.verb === 'deleted' ? 'deleted' : 'read';
    return { path: f.path, content: f.content || '', truncated: !!f.truncated, action, workspace: !!f.workspace, size: f.size, meta: f.replacements != null ? `${f.replacements} replacement${f.replacements === 1 ? '' : 's'}` : null };
  }
  const verbs = verbsFor(tool);
  if (!verbs.file || !att?.arguments?.path) return null;
  const action = verbs.file === 'write' ? 'wrote' : verbs.file === 'edit' ? 'edited' : verbs.file === 'delete' ? 'deleted' : 'read';
  return { path: att.arguments.path, content: '', truncated: false, action, workspace: tool.startsWith('file_') };
}

function prettyArgs(args) {
  try {
    const s = JSON.stringify(args, null, 1);
    return s.length > 500 ? s.slice(0, 500) + '…' : s;
  } catch {
    return String(args);
  }
}

function prettyOutput(output) {
  try {
    const parsed = JSON.parse(output);
    const flat = JSON.stringify(parsed);
    return flat.length > 600 ? flat.slice(0, 600) + '…' : flat;
  } catch {
    return String(output || '').slice(0, 600);
  }
}


function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}


export function activityCard({ tool, displayName, args, result, ok, denied, durationMs, file, callId, sensitive, autoApproved }, { live = false, onOpenFile } = {}) {
  const verbs = verbsFor(tool);
  const label = displayName || verbs.label || tool;
  const running = live && ok === undefined && ok !== false;
  const fileAction = verbs.file === 'write' ? 'wrote' : verbs.file === 'edit' ? 'edited' : verbs.file === 'delete' ? 'deleted' : 'read';
  const fileRef = file?.path
    ? {
        path: file.path,
        content: file.content || '',
        truncated: !!file.truncated,
        action: file.verb === 'wrote' ? (file.created ? 'wrote_new' : 'wrote') : file.verb === 'edited' ? 'edited' : file.verb === 'deleted' ? 'deleted' : 'read',
        workspace: !!file.workspace,
        size: file.size,
        meta: file.replacements != null ? `${file.replacements} replacement${file.replacements === 1 ? '' : 's'}` : null,
      }
    : args?.path && verbs.file
      ? { path: args.path, content: args.content, truncated: false, action: fileAction, workspace: String(tool).startsWith('file_') }
      : null;
  const hasPreview = !!verbs.file && !!fileRef?.path;
  const durationSuffix = !running && ok === true && durationMs != null ? ` · ${formatDuration(durationMs)}` : '';

  const el = h(
    'div',
    { class: `activity${ok === false ? ' err' : ''}${denied ? ' denied' : ''}${running ? ' running' : ''}`, dataset: callId ? { callId } : {} },
    h(
      'div',
      { class: 'activity-head' },
      h('span', { class: 'activity-icon', html: icon(verbs.icon), title: label }),
      h('span', { class: 'activity-title' },
        hasPreview && fileRef?.path
          ? h('span', { class: 'activity-file mono', text: shortPath(fileRef.path), title: label })
          : h('b', { text: label, title: label !== tool ? tool : undefined }),
        h('span', { class: 'activity-sub', text: denied ? ' — denied by you' : ok === false ? ' — failed' : running ? ` — ${verbs.run}…` : ` — ${verbs.done}${durationSuffix}` })
      ),
      h('span', { class: 'spacer' }),
      hasPreview && fileRef?.path && !running
        ? h('button', {
            class: 'activity-view',
            title: 'Open file preview',
            html: `${icon('eye')}<span>View</span>`,
            onclick: () =>
              (onOpenFile || openFilePreview)({
                name: fileRef.path.split(/[\\/]/).pop(),
                path: fileRef.path,
                content: fileRef.content ?? '',
                truncated: fileRef.truncated,
                action: fileRef.action,
                size: fileRef.size,
                workspace: fileRef.workspace,
                meta: fileRef.meta,
              }),
          })
        : null,
      running ? h('span', { class: 'activity-pulse', 'aria-hidden': 'true' }) : ok === true ? h('span', { class: 'badge accent', html: icon('check') }) : ok === false ? h('span', { class: 'badge red', html: icon('x') }) : null
    ),
    args !== undefined && !running ? h('details', { class: 'activity-args' }, h('summary', { text: 'arguments' }), h('pre', { text: prettyArgs(args) })) : null,
    result !== undefined && !running
      ? h('details', { class: 'activity-out' },
          h('summary', {}, h('span', { text: 'result' }), h('span', { class: 'result-preview mono', text: ` · ${shortOneLine(result)}` })),
          h('pre', { text: prettyOutput(result) }))
      : null
  );
  if (running) el.dataset.tool = tool;
  return el;
}


function shortOneLine(result) {
  const s = String(prettyOutput(result) || '').replace(/\s+/g, ' ');
  return s.length > 90 ? s.slice(0, 90) + '…' : s || '—';
}

function shortPath(p) {
  const s = String(p);
  const parts = s.split(/[\\/]/);
  if (parts.length <= 3) return s;
  return `${parts[0]}${parts[0].endsWith(':') ? '\\' : '/'}…${s.indexOf('\\') >= 0 ? '\\' : '/'}${parts.slice(-2).join('/')}`;
}


export function thinkingIndicator() {
  const label = h('span', { class: 'think-label', text: 'Thinking' });
  const body = h('div', { class: 'think-body' }, h('div', { class: 'think-stream', text: '' }));
  const chevron = h('span', { class: 'think-chevron', html: icon('chevronDown') });
  const el = h(
    'div',
    { class: 'thinking' },
    h(
      'button',
      {
        class: 'think-head',
        onclick: () => {
          const open = el.classList.toggle('open');
          el._open = open;
          if (open) body.scrollTop = body.scrollHeight;
        },
      },
      h('span', { class: 'think-orb', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      label,
      h('span', { class: 'spacer' }),
      chevron
    ),
    body
  );
  el._label = label;
  el._body = body.querySelector('.think-stream');
  el._open = false;
  return el;
}

const THINKING_LABELS = ['Thinking', 'Thinking through it', 'Working on it', 'Connecting the dots', 'Considering options'];
export function rotateThinkingLabel(el) {
  if (!el?._label) return null;
  let i = 0;
  const timer = setInterval(() => {
    i = (i + 1) % THINKING_LABELS.length;
    el._label.textContent = THINKING_LABELS[i];
  }, 4200);
  return () => clearInterval(timer);
}


export function planCard({ planId, understanding, steps, status = 'pending', requiresApproval = false, onDecision }) {
  const el = h('div', { class: `plan-card is-${status}`, dataset: { planId: planId || '' } });
  el.append(
    h(
      'div',
      { class: 'plan-head' },
      h('span', { class: 'plan-icon', html: icon('plan') }),
      h('div', { class: 'plan-title' },
        h('b', { text: 'Plan' }),
        h('span', { class: 'plan-status', text: { pending: ' — awaiting approval', approved: ' — executing', executing: ' — executing', denied: ' — declined', done: ' — complete' }[status] || '' })
      ),
      h('span', { class: 'spacer' }),
      h('span', { class: 'plan-count', text: `${steps.length} step${steps.length === 1 ? '' : 's'}` })
    ),
    ...(understanding ? [h('div', { class: 'plan-understanding', text: understanding })] : []),
    h(
      'ol',
      { class: 'plan-steps' },
      steps.map((s, i) =>
        h('li', {}, h('span', { class: 'plan-num', text: String(i + 1) }), h('div', { class: 'plan-step-body' }, h('span', { class: 'plan-step-title', text: s.title }), s.detail ? h('span', { class: 'plan-step-detail', text: s.detail }) : null))
      )
    )
  );

  if (status === 'pending' && requiresApproval) {
    const actions = h(
      'div',
      { class: 'plan-actions' },
      h('button', { class: 'btn sm primary', html: `${icon('check')}<span>Approve & run</span>`, onclick: () => decide('approved') }),
      h('button', { class: 'btn sm danger ghost', html: `${icon('x')}<span>Decline</span>`, onclick: () => decide('denied') })
    );
    el.append(actions);
    async function decide(decision) {
      for (const b of actions.querySelectorAll('button')) b.disabled = true;
      try {
        if (el._approvalId) await api.post(`/runs/approvals/${el._approvalId}`, { decision, scope: 'once' });
        el.classList.remove('is-pending');
        el.classList.add(decision === 'approved' ? 'is-approved' : 'is-denied');
        actions.remove();
        el.querySelector('.plan-status').textContent = decision === 'approved' ? ' — executing' : ' — declined';
        onDecision?.(decision);
      } catch (err) {
        for (const b of actions.querySelectorAll('button')) b.disabled = false;
        import('../ui.js').then(({ toast }) => toast(err.message, 'error'));
      }
    }
    el._setApprovalId = (id) => {
      el._approvalId = id;
    };
  }

  
  
  el._setProgress = (completed) => {
    const items = el.querySelectorAll('.plan-steps > li');
    items.forEach((li, i) => li.classList.toggle('done', i < completed));
    const count = el.querySelector('.plan-count');
    if (count && completed > 0) count.textContent = `${completed}/${items.length} steps`;
  };
  return el;
}


export function approvalCard({ approvalId, tool, displayName, summary, payload, onDecided }, { resolved = null } = {}) {
  const el = h('div', { class: `approval-card${resolved ? ' resolved' : ''}` });
  el.append(
    h('div', { class: 'approval-head' }, h('span', { class: 'approval-icon', html: icon(tool === 'plan' ? 'plan' : 'shield') }), h('span', { class: 'activity-title' }, h('b', { text: tool === 'plan' ? 'Zeno' : displayName || tool }), h('span', { text: tool === 'plan' ? ' wants to execute a plan' : ' wants to act' }))),
    h('div', { class: 'approval-summary', text: summary })
  );

  if (resolved) {
    el.append(h('div', { class: 'approval-resolved' }, resolved === 'approved' ? h('span', { class: 'badge accent', text: 'Approved' }) : h('span', { class: 'badge red', text: 'Denied' })));
    return el;
  }

  const actions = h(
    'div',
    { class: 'approval-actions' },
    h('button', { class: 'btn sm primary', html: `${icon('check')}<span>Allow once</span>`, onclick: () => decide('approved', 'once') }),
    h('button', { class: 'btn sm', html: `${icon('check')}<span>Allow for this task</span>`, onclick: () => decide('approved', 'task') }),
    h('button', { class: 'btn sm danger', html: `${icon('x')}<span>Deny</span>`, onclick: () => decide('denied', 'once') })
  );
  el.append(actions);

  async function decide(decision, scope) {
    for (const b of actions.querySelectorAll('button')) b.disabled = true;
    try {
      await api.post(`/runs/approvals/${approvalId}`, { decision, scope });
      actions.remove();
      el.classList.add('resolved');
      el.append(h('div', { class: 'approval-resolved' }, decision === 'approved' ? h('span', { class: 'badge accent', text: `Approved${scope === 'task' ? ' for this task' : ''}` }) : h('span', { class: 'badge red', text: 'Denied' })));
      onDecided?.(decision);
    } catch (err) {
      for (const b of actions.querySelectorAll('button')) b.disabled = false;
      import('../ui.js').then(({ toast }) => toast(err.message, 'error'));
    }
  }
  return el;
}



export function activityBlocksFromHistory(messages) {
  const blocks = [];
  for (const m of messages) {
    if (m.role === 'tool' && m.attachments && !Array.isArray(m.attachments) && m.attachments.kind === 'tool_result') {
      blocks.push({ type: 'tool', data: { tool: m.attachments.tool, ok: m.attachments.ok, denied: m.attachments.denied, file: m.attachments.file, result: m.content } });
    }
  }
  return blocks;
}

export function actingIndicator(label = 'Working…') {
  return h('div', { class: 'acting' }, h('span', { class: 'acting-dot' }), h('span', { text: label }));
}




export function snapshotCard({ action = 'captured', snapshotId, label, files, written, removed }) {
  const text =
    action === 'captured'
      ? `Checkpoint captured${files != null ? ` · ${files} file${files === 1 ? '' : 's'}` : ''}${label ? ` · ${label}` : ''}`
      : action === 'undo'
        ? `Undid workspace change · ${written ?? 0} restored, ${removed ?? 0} removed`
        : action === 'redo'
          ? `Redone workspace change · ${written ?? 0} restored, ${removed ?? 0} removed`
          : `Workspace restored · ${written ?? 0} written, ${removed ?? 0} removed`;
  return h(
    'div',
    { class: 'snap-chip', dataset: snapshotId ? { snapshotId } : {} },
    h('span', { class: 'snap-icon', html: icon(action === 'captured' ? 'history' : 'refresh') }),
    h('span', { text }),
    snapshotId ? h('span', { class: 'snap-id mono', text: snapshotId.slice(0, 14) }) : null
  );
}




export function subagentCard({ state = 'assigned', subSessionId, task, result }) {
  const el = h(
    'div',
    { class: `activity subagent-card is-${state}`, dataset: subSessionId ? { subSessionId } : {} },
    h(
      'div',
      { class: 'activity-head' },
      h('span', { class: 'activity-icon', html: icon('bot') }),
      h('span', { class: 'activity-title' },
        h('b', { text: 'Subagent' }),
        h('span', { class: 'activity-sub', text: state === 'assigned' ? ' — working on a subtask…' : state === 'failed' ? ' — failed' : ' — done' })
      ),
      h('span', { class: 'spacer' }),
      state === 'assigned' ? h('span', { class: 'activity-pulse', 'aria-hidden': 'true' }) : h('span', { class: `badge ${state === 'failed' ? 'red' : 'accent'}`, html: icon(state === 'failed' ? 'x' : 'check') })
    ),
    task ? h('div', { class: 'subagent-task', text: String(task).slice(0, 300) }) : null,
    result != null && state !== 'assigned'
      ? h('details', { class: 'activity-out' }, h('summary', {}, h('span', { text: 'result' })), h('pre', { text: String(result).slice(0, 800) }))
      : null
  );
  return el;
}




export function verificationCard({ level, ok, issues = [], confidence, checker, revised }) {
  const list = Array.isArray(issues) ? issues : [];
  const headline = revised
    ? 'Answer regenerated after verification'
    : ok
      ? 'Verification passed'
      : `${list.length} verification issue${list.length === 1 ? '' : 's'}`;
  const levelLabel = level && level !== 'none' ? ` · ${level} check` : '';
  const confLabel = Number.isFinite(Number(confidence)) ? ` · ${Math.round(confidence * 100)}% confidence` : '';
  const el = h(
    'div',
    { class: `activity review-card${list.length ? ' has-findings' : ''}` },
    h(
      'div',
      { class: 'activity-head' },
      h('span', { class: 'activity-icon', html: icon(ok ? 'shieldCheck' : 'alert') }),
      h('span', { class: 'activity-title' },
        h('b', { text: 'Verification' }),
        h('span', { class: 'activity-sub', text: ` — ${headline}${levelLabel}${confLabel}` })
      ),
      h('span', { class: 'spacer' }),
      h('span', { class: `badge ${list.length && !revised ? 'red' : 'accent'}`, html: icon(revised ? 'refresh' : ok ? 'check' : 'alert') })
    ),
    list.length && !revised
      ? h(
          'ul',
          { class: 'review-findings' },
          list.slice(0, 6).map((f) => {
            const claim = typeof f === 'string' ? f : f?.claim || '';
            const problem = typeof f === 'string' ? '' : f?.problem || '';
            return h('li', {}, h('span', { class: 'review-sev sev-note', text: 'note' }), h('span', { text: [claim && claim !== '(answer)' ? `“${claim}”` : '', problem].filter(Boolean).join(' — ') || String(f) }));
          })
        )
      : null
  );
  return el;
}



export function reviewCard({ findings = [], verdict, diffSummary }) {
  const list = Array.isArray(findings) ? findings : [];
  const el = h(
    'div',
    { class: `activity review-card${list.length ? ' has-findings' : ''}` },
    h(
      'div',
      { class: 'activity-head' },
      h('span', { class: 'activity-icon', html: icon('eye') }),
      h('span', { class: 'activity-title' },
        h('b', { text: 'AI review' }),
        h('span', { class: 'activity-sub', text: ` — ${list.length ? `${list.length} finding${list.length === 1 ? '' : 's'}` : 'no issues found'}${verdict ? ` · ${verdict}` : ''}` })
      ),
      h('span', { class: 'spacer' }),
      h('span', { class: `badge ${list.length ? 'red' : 'accent'}`, html: icon(list.length ? 'alert' : 'check') })
    ),
    diffSummary ? h('div', { class: 'review-summary', text: String(diffSummary).slice(0, 300) }) : null,
    list.length
      ? h(
          'ul',
          { class: 'review-findings' },
          list.slice(0, 8).map((f) => {
            const text = typeof f === 'string' ? f : f.issue || f.message || f.title || JSON.stringify(f).slice(0, 200);
            return h('li', {}, h('span', { class: `review-sev sev-${(f?.severity || 'note').toLowerCase()}`, text: String(f?.severity || 'note') }), h('span', { text }));
          })
        )
      : null
  );
  return el;
}
