

import { h, openDropdown, closeMenu, fmtTokens, toast } from '../ui.js';
import { icon } from '../icons.js';
import { store, currentModel, defaultModel } from '../state.js';
import { api } from '../api.js';

export function modelChip(onChange) {
  const model = currentModel() || defaultModel();
  const chip = h(
    'button',
    { class: 'model-chip', title: 'Switch model', onclick: (e) => openModelMenu(e.currentTarget, onChange) },
    h('span', { class: 'dot' }),
    h('span', { class: 'label', text: model ? model.displayName : 'No model — add a provider' }),
    h('span', { html: icon('chevronDown') })
  );
  return chip;
}

export function openModelMenu(anchor, onChange) {
  const { models, providers } = store.state;
  openDropdown(
    anchor,
    (menu, close) => {
      menu.classList.add('model-menu');
      if (!models.length) {
        menu.append(
          h('div', { class: 'palette-empty' },
            h('p', { text: 'No models configured yet.' }),
            h('button', {
              class: 'btn primary sm', style: 'margin-top:10px',
              text: 'Add a provider',
              onclick: () => { close(); location.hash = '#/settings/providers'; },
            })
          )
        );
        return;
      }
      const byProvider = new Map();
      for (const m of models) {
        if (!byProvider.has(m.providerId)) byProvider.set(m.providerId, []);
        byProvider.get(m.providerId).push(m);
      }
      const selectedId = (currentModel() || defaultModel())?.id;
      for (const [providerId, list] of byProvider) {
        const provider = providers.find((p) => p.id === providerId);
        menu.append(h('div', { class: 'menu-head', text: provider?.name || 'Unknown provider' }));
        for (const m of list) {
          menu.append(
            h(
              'button',
              {
                class: 'menu-item model-row',
                onclick: async () => {
                  close();
                  try {
                    await onChange?.(m);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              h('span', { html: selectedId === m.id ? icon('check') : icon('circle'), style: `width:15px;height:15px;flex:none;opacity:${selectedId === m.id ? 1 : 0.25}` }),
              h(
                'span',
                { style: 'min-width:0' },
                h('span', { class: 'ellipsis', style: 'display:block', text: m.displayName }),
                h(
                  'span',
                  { class: 'meta' },
                  m.contextWindow ? h('span', { class: 'badge', text: fmtTokens(m.contextWindow) + ' ctx' }) : null,
                  ...(m.capabilities || []).slice(0, 3).map((c) => h('span', { class: `badge ${capClass(c)}`, text: c }))
                )
              )
            )
          );
        }
      }
      menu.append(h('div', { class: 'menu-sep' }));
      menu.append(
        h('button', { class: 'menu-item', html: `${icon('settings')}<span>Manage providers & models</span>`, onclick: () => { close(); location.hash = '#/settings/providers'; } })
      );
    },
    { width: 340 }
  );
}

function capClass(cap) {
  return { tools: 'blue', vision: 'violet', reasoning: 'amber', embeddings: '' }[cap] || '';
}


export async function setConversationModel(conv, model) {
  store.update({ currentModelId: model.id });
  if (conv) {
    await api.patch(`/conversations/${conv.id}`, {
      modelId: model.id,
      modelLabel: model.displayName,
      providerId: model.providerId,
    });
    
    store.update({
      conversations: store.state.conversations.map((c) =>
        c.id === conv.id ? { ...c, modelId: model.id, modelLabel: model.displayName, providerId: model.providerId } : c
      ),
    });
  } else {
    await api.patch('/settings', { settings: { default_model: { modelId: model.id } } });
    const { loadSettings } = await import('../app.js');
    await loadSettings();
  }
}
