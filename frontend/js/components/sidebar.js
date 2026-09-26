
import { h } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';
import { confirmDialog, timeAgo, toast } from '../ui.js';

function conversationRow(conv, currentId) {
  return h(
    'div',
    {
      class: `row-item${conv.id === currentId ? ' is-active' : ''}`,
      role: 'button',
      tabindex: '0',
      onclick: () => location.hash = `#/chat/${conv.id}`,
      onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/chat/${conv.id}`),
      dataset: { id: conv.id },
    },
    h(
      'div',
      { class: 'ri-main' },
      h('div', { class: 'ri-title', text: conv.title || 'Untitled' }),
      h('div', { class: 'ri-sub', text: [conv.modelLabel, timeAgo(conv.updatedAt)].filter(Boolean).join(' · ') })
    ),
    h(
      'div',
      { class: 'ri-actions' },
      conv.pinned ? h('span', { html: icon('pin'), style: 'color:var(--accent);width:15px' }) : null,
      h('button', {
        class: 'icon-btn',
        title: 'Delete conversation',
        html: icon('trash'),
        onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog({ title: 'Delete conversation?', message: `"${conv.title}" and its messages will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
          try {
            await api.del(`/conversations/${conv.id}`);
            const { loadConversations } = await import('../app.js');
            await loadConversations();
            if (store.state.currentConversationId === conv.id) location.hash = '#/chat';
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      })
    )
  );
}

export function renderSidebarContent(section, container) {
  container.innerHTML = '';
  const { conversations, projects, currentConversationId } = store.state;

  if (section === 'chat') {
    const pinned = conversations.filter((c) => c.pinned);
    const rest = conversations.filter((c) => !c.pinned);
    if (pinned.length) {
      container.append(h('div', { class: 'sidebar-group-label', text: 'Pinned' }));
      for (const c of pinned) container.append(conversationRow(c, currentConversationId));
    }
    if (rest.length) {
      container.append(h('div', { class: 'sidebar-group-label', text: 'Recent' }));
      for (const c of rest.slice(0, 40)) container.append(conversationRow(c, currentConversationId));
    }
    if (!conversations.length) {
      container.append(
        h('div', { class: 'empty', style: 'padding:28px 12px' },
          h('div', { class: 'empty-icon', html: icon('chat') }),
          h('p', { class: 'faint', text: 'No conversations yet. Start one!' })
        )
      );
    }
  }

  if (section === 'projects') {
    for (const p of projects) {
      container.append(
        h(
          'div',
          {
            class: 'row-item',
            role: 'button', tabindex: '0',
            onclick: () => (location.hash = `#/projects`),
          },
          h('span', { html: icon('folder'), class: 'lead' }),
          h('div', { class: 'ri-main' }, h('div', { class: 'ri-title', text: p.name }), h('div', { class: 'ri-sub', text: p.description || '' }))
        )
      );
    }
    if (!projects.length) container.append(h('div', { class: 'empty', style: 'padding:28px 12px' }, h('p', { class: 'faint', text: 'No projects yet.' })));
  }
}
