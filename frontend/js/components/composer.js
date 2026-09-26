

import { h, toast, openDropdown } from '../ui.js';
import { icon } from '../icons.js';
import { store, currentConversation, currentModel, defaultModel } from '../state.js';
import { api } from '../api.js';
import { modelChip, setConversationModel } from './model-picker.js';

const PERMISSION_MODES = [
  { id: 'ask', label: 'Ask Before Change', hint: 'Sensitive actions pause for your approval.', icon: 'shield', tone: 'amber' },
  { id: 'edit_auto', label: 'Edit Automatically', hint: 'Workspace files change automatically; shell, code and local actions still ask.', icon: 'edit', tone: 'green' },
  { id: 'workspace', label: 'Workspace Edit', hint: 'Workspace files change automatically; other sensitive actions still ask.', icon: 'shieldCheck', tone: 'blue' },
  { id: 'full', label: 'Full Access', hint: 'Everything runs without approval, including your local computer. Only in environments you trust.', icon: 'shieldBolt', tone: 'red' },
];

async function persistSetting(key, value) {
  try {
    await api.patch('/settings', { settings: { [key]: value } });
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function createComposer({ onSend, onStop, onAttach }) {
  let streaming = false;
  let disposed = false;
  let uploading = false;

  const textarea = h('textarea', {
    placeholder: 'Message Zeno…',
    rows: '1',
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    oninput: () => {
      autosize();
      updateSendState();
    },
    'aria-label': 'Message',
  });

  const attachmentsRow = h('div', { class: 'composer-attachments' });
  const sendBtn = h('button', { class: 'send-btn', title: 'Send (Enter)', html: icon('arrowUp'), onclick: () => (streaming ? onStop?.() : submit()) });

  const fileInput = h('input', { type: 'file', multiple: true, style: 'display:none', onchange: handleFiles });

  const uploadBtn = h('button', {
    class: 'icon-btn',
    title: 'Attach files (images, text, PDF)',
    html: icon('paperclip'),
    onclick: () => fileInput.click(),
  });

  const modelBtn = modelChip(async (model) => {
    await setConversationModel(currentConversation(), model);
    refreshModelChip();
  });
  function refreshModelChip() {
    const model = currentModel() || defaultModel();
    modelBtn.querySelector('.label').textContent = model ? model.displayName : 'Choose a model';
    updateSendState();
  }

  
  const permDot = h('span', { class: 'perm-dot' });
  const permLabel = h('span', { class: 'label', text: 'Ask Before Change' });
  const permBtn = h(
    'button',
    {
      class: 'perm-chip',
      title: 'Permission mode — controls what Zeno may do without asking',
      onclick: (e) => {
        if (streaming) return;
        openDropdown(e.currentTarget, (menu, close) => {
          menu.classList.add('perm-menu');
          menu.append(h('div', { class: 'menu-label', text: 'Permission mode' }));
          for (const mode of PERMISSION_MODES) {
            const active = store.state.permissionMode === mode.id;
            menu.append(
              h(
                'button',
                {
                  class: `menu-item perm-option tone-${mode.tone}${active ? ' is-active' : ''}`,
                  onclick: async () => {
                    close();
                    store.update({ permissionMode: mode.id });
                    renderPermChip();
                    await persistSetting('permission_mode', mode.id);
                  },
                },
                h('span', { class: 'perm-ico', html: icon(mode.icon) }),
                h('span', { class: 'perm-copy' }, h('strong', { text: mode.label }), h('span', { class: 'perm-hint', text: mode.hint })),
                active ? h('span', { class: 'perm-active', html: icon('check') }) : null
              )
            );
          }
        }, { width: 316 });
      },
    },
    permDot,
    permLabel,
    h('span', { class: 'perm-chevron', html: icon('chevronDown') })
  );
  function renderPermChip() {
    const mode = PERMISSION_MODES.find((m) => m.id === store.state.permissionMode) || PERMISSION_MODES[0];
    permLabel.textContent = mode.label;
    permBtn.className = `perm-chip tone-${mode.tone}`;
    permBtn.title = `Permission mode: ${mode.label} — ${mode.hint}`;
  }
  renderPermChip();

  
  const planBtn = h(
    'button',
    {
      class: 'plan-chip',
      title: 'Plan Mode — Zeno analyzes first and proposes a plan before any action',
      onclick: async () => {
        if (streaming) return;
        const next = !store.state.planMode;
        store.update({ planMode: next });
        renderPlanChip();
        await persistSetting('plan_mode', next);
      },
    },
    h('span', { class: 'plan-ico', html: icon('plan') }),
    h('span', { class: 'label', text: 'Plan' })
  );
  function renderPlanChip() {
    planBtn.classList.toggle('on', !!store.state.planMode);
    planBtn.setAttribute('aria-pressed', String(!!store.state.planMode));
  }
  renderPlanChip();

  const hint = h('div', { class: 'upload-hint' });

  const composer = h(
    'div',
    { class: 'composer' },
    attachmentsRow,
    textarea,
    h(
      'div',
      { class: 'composer-bar' },
      uploadBtn,
      modelBtn,
      h('div', { class: 'composer-sep', 'aria-hidden': 'true' }),
      permBtn,
      planBtn,
      h('div', { class: 'spacer' }),
      sendBtn
    ),
    fileInput
  );

  const zone = h(
    'div',
    { class: 'composer-zone' },
    composer,
    hint,
    h('div', { class: 'composer-note', text: 'Zeno picks the right tools, skills, and connections for each request. Switch the permission mode above to control what runs automatically.' })
  );

  function autosize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 260) + 'px';
  }

  function updateSendState() {
    const hasModel = !!(currentModel() || defaultModel());
    sendBtn.disabled = streaming ? false : !textarea.value.trim() && !store.state.attachments.length;
    if (!streaming) sendBtn.disabled = sendBtn.disabled || !hasModel || uploading;
    modelBtn.disabled = streaming;
    uploadBtn.disabled = streaming || uploading;
    sendBtn.classList.toggle('stop', streaming);
    sendBtn.innerHTML = streaming ? icon('stop') : icon('arrowUp');
    sendBtn.title = streaming ? 'Stop generating' : 'Send (Enter)';
  }

  function setStreaming(v) {
    streaming = v;
    updateSendState();
  }

  function submit() {
    if (streaming || uploading || disposed) return;
    const content = textarea.value.trim();
    const attachments = [...store.state.attachments];
    if (!content && !attachments.length) return;
    const hasModel = !!(currentModel() || defaultModel());
    if (!hasModel) {
      toast('Add a provider and select a model first', 'error');
      return;
    }
    textarea.value = '';
    autosize();
    store.update({ attachments: [] });
    renderAttachments();
    onSend?.({ content, attachments });
    updateSendState();
  }

  async function handleFiles() {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length || disposed) return;
    uploading = true;
    updateSendState();
    hint.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    hint.className = 'upload-hint';
    try {
      const conv = currentConversation();
      const res = await api.upload('/files', files, conv?.projectId ? { projectId: conv.projectId } : {});
      if (disposed) return;
      for (const f of res.files) {
        store.state.attachments.push({ id: f.id, name: f.filename, kind: f.kind, mime: f.mime, size: f.size });
      }
      if (res.errors?.length) {
        hint.textContent = res.errors.map((e) => `${e.filename}: ${e.error}`).join(' · ');
        hint.className = 'upload-hint error';
      } else {
        hint.textContent = '';
      }
      renderAttachments();
      updateSendState();
    } catch (err) {
      hint.textContent = `Upload failed: ${err.message}`;
      hint.className = 'upload-hint error';
    } finally {
      uploading = false;
      if (!disposed) updateSendState();
    }
  }

  function renderAttachments() {
    attachmentsRow.innerHTML = '';
    for (const a of store.state.attachments) {
      attachmentsRow.append(
        h(
          'span',
          { class: 'att-chip' },
          h('span', { html: icon(a.kind === 'image' ? 'image' : 'file') }),
          h('span', { class: 'name', text: a.name }),
          h('button', {
            class: 'icon-btn',
            style: 'width:22px;height:22px',
            html: icon('x'),
            onclick: () => {
              store.state.attachments = store.state.attachments.filter((x) => x.id !== a.id);
              renderAttachments();
              updateSendState();
            },
          })
        )
      );
    }
  }

  const unsubscribeModel = store.subscribe('currentModelId', refreshModelChip);
  const unsubscribeAttachments = store.subscribe('attachments', () => { renderAttachments(); updateSendState(); });
  renderAttachments();
  updateSendState();
  return {
    el: zone,
    textarea,
    setStreaming,
    refreshModelChip,
    renderPermChip,
    renderPlanChip,
    focus: () => textarea.focus(),
    updateSendState,
    destroy() { disposed = true; unsubscribeModel(); unsubscribeAttachments(); },
  };
}
