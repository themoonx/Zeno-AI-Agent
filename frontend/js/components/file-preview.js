



import { h, copyText, fmtBytes } from '../ui.js';
import { icon } from '../icons.js';
import { fileTypeFor } from '../filetypes.js';
import { hljs } from '../markdown.js';

let panel = null;
let current = null;
let returnFocusTo = null;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(code, language) {
  if (language && language !== 'text' && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch { /* fall through to plain */ }
  }
  return escapeHtml(code);
}

function close() {
  panel?.remove();
  panel = null;
  current = null;
  document.removeEventListener('keydown', onKey);
  returnFocusTo?.focus?.();
  returnFocusTo = null;
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}

const MAX_LINES = 3000;

export function openFilePreview({ name, path, content = '', action = 'read', truncated = false, size = null, workspace = true, meta = null }) {
  const type = fileTypeFor(name || path);
  const displayName = name || String(path).split(/[\\/]/).pop();
  const wasOpen = !!panel;
  if (!wasOpen) returnFocusTo = document.activeElement;
  current = { name: displayName, path };
  const scrim = h('div', { class: 'fp-scrim', onclick: close });

  const actionLabel = { read: 'Read', wrote: 'Written', wrote_new: 'Created', edited: 'Edited', deleted: 'Deleted' }[action] || action;

  const lines = String(content ?? '').split('\n');
  const rendered = lines.slice(0, MAX_LINES);
  const lineNumbers = rendered.map((_, i) => h('span', { text: String(i + 1) }));
  const codeHtml = rendered.map((line) => `<span class="fp-line">${highlight(line, type.language) || '&#8203;'}</span>`).join('\n');

  const body = h(
    'div',
    { class: 'fp-body' },
    action === 'deleted'
      ? h('div', { class: 'fp-empty' }, h('span', { html: icon('trash') }), h('p', { text: 'This file was deleted.' }), h('p', { class: 'faint', text: path }))
      : [
          h('div', { class: 'fp-code' },
            h('div', { class: 'fp-gutter', 'aria-hidden': 'true' }, lineNumbers),
            h('pre', { class: 'fp-pre' }, h('code', { html: codeHtml }))
          ),
          lines.length > MAX_LINES || truncated
            ? h('div', { class: 'fp-note' }, h('span', { html: icon('info') }), h('span', { text: truncated ? 'Preview truncated — the full file is on disk.' : `Showing the first ${MAX_LINES} lines.` }))
            : null,
        ]
  );

  panel?.remove();
  document.removeEventListener('keydown', onKey);
  panel = h(
    'div',
    { class: `file-preview${wasOpen ? ' instant' : ''}`, role: 'dialog', 'aria-label': `File preview: ${displayName}` },
    h(
      'div',
      { class: 'fp-titlebar' },
      h('div', { class: 'fp-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('div', { class: 'fp-title' },
        h('span', { class: 'fp-fileicon', style: `color:${type.color}`, html: icon(type.icon) }),
        h('span', { class: 'fp-name', text: displayName }),
        h('span', { class: 'fp-badge', text: actionLabel, dataset: { action } })
      ),
      h('div', { class: 'fp-actions' },
        size != null ? h('span', { class: 'fp-size', text: fmtBytes(size) }) : null,
        content && action !== 'deleted'
          ? h('button', { class: 'icon-btn', title: 'Copy contents', html: icon('copy'), onclick: () => copyText(content) })
          : null,
        h('button', { class: 'icon-btn', title: 'Close (Esc)', html: icon('x'), onclick: close })
      )
    ),
    h(
      'div',
      { class: 'fp-pathbar' },
      h('span', { class: 'fp-scope', text: workspace ? 'workspace' : 'local computer' }),
      h('span', { class: 'fp-path mono', text: path, title: path }),
      meta ? h('span', { class: 'fp-meta', text: meta }) : null
    ),
    body
  );

  document.body.append(scrim, panel);
  document.addEventListener('keydown', onKey);
  panel.querySelector('.icon-btn[title^="Close"]')?.focus();
  return { close };
}
