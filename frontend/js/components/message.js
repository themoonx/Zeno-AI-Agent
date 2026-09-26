

import { h, copyText, fmtTokens } from '../ui.js';
import { icon, zenoMark } from '../icons.js';
import { markdownEl } from '../markdown.js';
import { api } from '../api.js';

export function renderUserMessage(msg, { onEdit } = {}) {
  const wrap = h('div', { class: 'msg user', dataset: { id: msg.id } });

  const attachments = (msg.attachments || []).map((a) =>
    a.kind === 'image'
      ? h('img', {
          class: 'att-thumb',
          src: api.fileUrl(a.id),
          alt: a.name,
          title: a.name,
          onclick: () => window.open(api.fileUrl(a.id), '_blank'),
        })
      : h('span', { class: 'att-chip' }, h('span', { html: icon('file') }), h('span', { class: 'name', text: a.name }))
  );
  if (attachments.length) wrap.append(h('div', { class: 'msg-attachments' }, attachments));

  
  
  const display = String(msg.content || '').replace(/\n?<file name="[^"]*"[^>]*(?:\/>|>[\s\S]*?<\/file>)/g, '');
  wrap.append(h('div', { class: 'bubble', text: display.trim() || msg.content }));
  wrap.append(
    h(
      'div',
      { class: 'msg-actions' },
      h('button', { class: 'icon-btn', title: 'Copy', html: icon('copy'), onclick: () => copyText(msg.content) }),
      onEdit
        ? h('button', {
            class: 'icon-btn',
            title: 'Edit & resend',
            html: icon('edit'),
            onclick: () => onEdit(msg),
          })
        : null
    )
  );
  return wrap;
}

export function renderAssistantMessage(msg, { streaming = false, onRegenerate } = {}) {
  const wrap = h('div', { class: 'msg assistant', dataset: { id: msg.id || '' } });
  wrap.append(
    h(
      'div',
      { class: 'msg-label' },
      h('span', { class: 'msg-avatar', html: zenoMark(12) }),
      h('span', { text: msg.modelLabel || 'Assistant' })
    )
  );

  if (msg.reasoning) {
    const details = h(
      'details',
      { class: 'reasoning' },
      h('summary', {}, h('span', { html: icon('brain') }), h('span', { text: 'Reasoning' })),
      h('div', { class: 'reasoning-body', text: msg.reasoning })
    );
    wrap.append(details);
    wrap._reasoningBody = details.querySelector('.reasoning-body');
  }

  const bodyEl = h('div', { class: 'md-target' });
  if (msg.content) bodyEl.append(markdownEl(msg.content));
  else if (!streaming && !msg.reasoning) bodyEl.append(h('span', { class: 'faint', text: '(empty response)' }));
  wrap.append(bodyEl);
  wrap._bodyEl = bodyEl;

  if (streaming) {
    bodyEl.append(h('span', { class: 'cursor-blink' }));
  }

  if (msg.status === 'error') {
    wrap.append(
      h(
        'div',
        { class: 'stream-error' },
        h('span', { html: icon('alert') }),
        h('span', {}, h('span', { text: msg.error || 'Generation failed. ' }), onRegenerate ? h('button', { class: 'retry', text: 'Retry', onclick: onRegenerate }) : null)
      )
    );
  }

  if (!streaming) {
    wrap.append(
      h(
        'div',
        { class: 'msg-actions' },
        h('button', { class: 'icon-btn', title: 'Copy', html: icon('copy'), onclick: () => copyText(msg.content) }),
        onRegenerate
          ? h('button', { class: 'icon-btn', title: 'Regenerate', html: icon('refresh'), onclick: onRegenerate })
          : null,
        msg.usage
          ? h(
              'span',
              { class: 'msg-meta' },
              `${fmtTokens(msg.usage.promptTokens ?? 0)} → ${fmtTokens(msg.usage.completionTokens ?? 0)} tokens`
            )
          : null
      )
    );
  }
  return wrap;
}
