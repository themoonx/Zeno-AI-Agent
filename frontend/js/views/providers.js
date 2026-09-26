

import { h, toast, confirmDialog, openModal, fmtTokens, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';

export function mountProvidersView(root, { embedded = false } = {}) {
  const view = h('div', { class: embedded ? 'settings-embed' : 'view' }, h('div', { class: 'view-inner' }));
  root.append(view);
  const inner = view.querySelector('.view-inner');

  function render() {
    const { providers, models, providerKinds } = store.state;
    inner.innerHTML = '';

    const description = 'Connect any AI provider — OpenAI, Anthropic, Gemini, Ollama, or any OpenAI-compatible endpoint. Add your own API keys; they are encrypted at rest and never leave this server.';
    const addButton = h('button', { class: 'btn primary', html: `${icon('plus')}<span>Add provider</span>`, onclick: addProviderModal });
    inner.append(
      embedded
        ? h('div', { class: 'settings-panel-head' },
            h('div', {}, h('h2', { text: 'Providers & models' }), h('p', { class: 'muted', text: description })),
            addButton)
        : h('div', { class: 'view-head row', style: 'justify-content:space-between;align-items:flex-start' },
            h('div', {}, h('h1', { text: 'Providers & Models' }), h('p', { text: description })),
            addButton)
    );

    if (!providers.length) {
      inner.append(
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon', html: icon('plug') }),
          h('h3', { text: 'No providers connected' }),
          h('p', { text: 'Add your first provider to bring your own models into the workspace. Local servers like Ollama work too.' }),
          h('div', { class: 'empty-actions' }, h('button', { class: 'btn primary', html: `${icon('plus')}<span>Add provider</span>`, onclick: addProviderModal }))
        )
      );
      return;
    }

    const grid = h('div', { class: 'card-grid' });
    for (const p of providers) {
      const pModels = models.filter((m) => m.providerId === p.id);
      const kindMeta = providerKinds[p.kind];
      grid.append(
        h(
          'div',
          { class: 'card provider-card' },
          h(
            'div',
            { class: 'pc-head' },
            h('div', { class: 'pc-icon', text: (p.name || '?').slice(0, 2).toUpperCase() }),
            h(
              'div',
              { style: 'flex:1;min-width:0' },
              h('div', { class: 'pc-title', text: p.name }),
              h('div', { class: 'pc-sub', title: p.baseUrl, text: p.baseUrl })
            ),
            statusBadge(p.status)
          ),
          h(
            'div',
            { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
            h('span', { class: 'badge', text: kindMeta?.label || p.kind }),
            p.hasCredentials ? h('span', { class: 'badge accent', html: `${icon('key')}<span>key stored</span>` }) : h('span', { class: 'badge', text: 'no auth' }),
            p.statusDetail && p.status === 'error' ? h('span', { class: 'badge red', title: p.statusDetail, text: 'check failed' }) : null
          ),
          pModels.length
            ? h(
                'div',
                { class: 'model-tags' },
                ...pModels.map((m) =>
                  h(
                    'span',
                    {
                      class: 'model-tag',
                      title: `${m.modelId}\nContext: ${m.contextWindow ? fmtTokens(m.contextWindow) : '—'}\nCapabilities: ${(m.capabilities || []).join(', ') || '—'}`,
                    },
                    h('span', { text: m.displayName }),
                    m.contextWindow ? h('span', { class: 'ctx', text: fmtTokens(m.contextWindow) }) : null,
                    h('button', {
                      class: 'icon-btn',
                      style: 'width:20px;height:20px',
                      html: icon('x'),
                      title: 'Remove model',
                      onclick: async (e) => {
                        e.stopPropagation();
                        if (!(await confirmDialog({ title: 'Remove model?', message: `"${m.displayName}" will be removed.`, confirmLabel: 'Remove', danger: true }))) return;
                        await api.del(`/providers/models/${m.id}`);
                        await reload();
                      },
                    })
                  )
                )
              )
            : h('div', { class: 'faint', style: 'font-size:var(--fs-sm)', text: 'No models registered yet.' }),
          h(
            'div',
            { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
            h('button', { class: 'btn sm', html: `${icon('plus')}<span>Model</span>`, onclick: () => addModelModal(p) }),
            h('button', { class: 'btn sm ghost', html: `${icon('zap')}<span>Test</span>`, onclick: () => testProvider(p) }),
            h('button', { class: 'btn sm ghost', html: `${icon('edit')}<span>Edit</span>`, onclick: () => editProviderModal(p) }),
            h('div', { class: 'spacer' }),
            h('button', {
              class: 'icon-btn danger',
              title: 'Delete provider',
              html: icon('trash'),
              onclick: async () => {
                if (!(await confirmDialog({ title: 'Delete provider?', message: `"${p.name}" and its ${pModels.length} model(s) will be removed. Conversations keep their history.`, confirmLabel: 'Delete', danger: true }))) return;
                await api.del(`/providers/${p.id}`);
                toast('Provider deleted', 'success');
                await reload();
              },
            })
          )
        )
      );
    }
    inner.append(h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { text: 'Connected providers' })), grid));

    if (Object.keys(providerKinds).length === 0) {
      
      loadMeta();
    }
  }

  function statusBadge(status) {
    const map = {
      connected: ['accent', 'connected'],
      error: ['red', 'error'],
      unverified: ['', 'not tested'],
    };
    const [cls, label] = map[status] || map.unverified;
    return h('span', { class: `badge ${cls}`, text: label });
  }

  async function testProvider(p) {
    toast(`Testing ${p.name}…`, 'info', { timeout: 1500 });
    try {
      const res = await api.post(`/providers/${p.id}/test`);
      if (res.ok) toast(`${p.name}: connected — ${res.modelCount} models visible`, 'success');
      else toast(`${p.name}: ${res.error}`, 'error');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  
  function addProviderModal() {
    const kinds = Object.entries(store.state.providerKinds);
    if (!kinds.length) {
      toast('Provider catalog not loaded yet', 'error');
      return;
    }

    let currentKind = kinds[0][0];
    const nameInput = h('input', { class: 'input', placeholder: 'e.g. My OpenAI, OpenRouter, Local Ollama' });
    const urlInput = h('input', { class: 'input', placeholder: 'https://api.example.com/v1' });
    const keyInput = h('input', { class: 'input', type: 'password', placeholder: 'API key (leave empty for local servers)' });
    const headersInput = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Optional custom headers as JSON, e.g. {"HTTP-Referer":"https://mysite.com"}' });
    const testCheck = h('input', { type: 'checkbox', checked: true });
    const testResult = h('div', { class: 'hint' });

    const urlRow = h('div', { class: 'field' }, h('label', { text: 'API base URL' }), urlInput, h('span', { class: 'hint' }));
    const keyRow = h('div', { class: 'field' }, h('label', { text: 'API key' }), keyInput, h('span', { class: 'hint' }));

    function applyKind(kindId, meta) {
      currentKind = kindId;
      nameInput.value = nameInput.value && !nameInput.dataset.touched ? '' : nameInput.value;
      nameInput.placeholder = `e.g. ${meta.label}`;
      urlInput.value = meta.defaultBaseUrl || '';
      urlRow.querySelector('.hint').textContent = meta.docsHint || '';
      keyRow.querySelector('.hint').textContent = meta.requiresKey ? 'Required for this provider type' : 'Optional for local servers';
      keyRow.style.display = kinds.length && meta.protocol ? '' : '';
    }

    const kindSelect = h(
      'select',
      {
        class: 'select',
        onchange: (e) => applyKind(e.target.value, store.state.providerKinds[e.target.value]),
      },
      kinds.map(([id, meta]) => h('option', { value: id, text: `${meta.label} — ${meta.protocol}` }))
    );
    nameInput.addEventListener('input', () => (nameInput.dataset.touched = '1'));

    const modal = openModal({
      title: 'Add provider',
      subtitle: 'Connect an AI provider. Credentials are encrypted (AES-256-GCM) before storage.',
      body: [
        h('div', { class: 'field' }, h('label', { text: 'Provider type' }), kindSelect),
        h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
        urlRow,
        keyRow,
        h('div', { class: 'field' }, h('label', { text: 'Extra headers (optional)' }), headersInput),
        h('label', { class: 'checkbox' }, testCheck, h('span', { text: 'Test connection before saving' })),
        testResult,
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h(
          'button',
          {
            class: 'btn primary',
            text: 'Add provider',
            onclick: async () => {
              let extraHeaders = {};
              if (headersInput.value.trim()) {
                try {
                  extraHeaders = JSON.parse(headersInput.value);
                } catch {
                  testResult.textContent = 'Headers must be valid JSON';
                  testResult.style.color = 'var(--red)';
                  return;
                }
              }
              try {
                const res = await api.post('/providers', {
                  kind: currentKind,
                  name: nameInput.value.trim(),
                  baseUrl: urlInput.value.trim(),
                  apiKey: keyInput.value.trim() || undefined,
                  extraHeaders,
                  test: testCheck.checked,
                });
                if (res.testResult) {
                  if (res.testResult.ok) toast(`Connected — ${res.testResult.modelCount} models visible`, 'success');
                  else toast(`Saved, but the connection check failed: ${res.testResult.error}`, 'info', { timeout: 8000 });
                }
                await reload();
                modal.close();
              } catch (err) {
                testResult.textContent = err.message;
                testResult.style.color = 'var(--red)';
              }
            },
          }
        ),
      ],
    });
    applyKind(kindSelect.value, store.state.providerKinds[kindSelect.value]);
  }

  function editProviderModal(p) {
    const nameInput = h('input', { class: 'input', value: p.name });
    const urlInput = h('input', { class: 'input', value: p.baseUrl });
    const keyInput = h('input', { class: 'input', type: 'password', placeholder: p.hasCredentials ? 'Leave empty to keep current key' : 'Add API key' });
    const headersInput = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Optional JSON headers' });
    if (Object.keys(p.extraHeaders || {}).length) headersInput.value = JSON.stringify(p.extraHeaders);

    const modal = openModal({
      title: `Edit ${p.name}`,
      body: [
        h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
        h('div', { class: 'field' }, h('label', { text: 'API base URL' }), urlInput),
        h('div', { class: 'field' }, h('label', { text: 'API key' }), keyInput),
        h('div', { class: 'field' }, h('label', { text: 'Extra headers' }), headersInput),
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h(
          'button',
          {
            class: 'btn primary',
            text: 'Save',
            onclick: async () => {
              try {
                const body = { name: nameInput.value.trim(), baseUrl: urlInput.value.trim() };
                if (keyInput.value.trim()) body.apiKey = keyInput.value.trim();
                if (headersInput.value.trim()) body.extraHeaders = JSON.parse(headersInput.value);
                await api.patch(`/providers/${p.id}`, body);
                await reload();
                modal.close();
                toast('Provider updated', 'success');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }
        ),
      ],
    });
  }

  
  async function addModelModal(provider) {
    let remoteModels = [];
    const listBtn = h('button', { class: 'btn sm', html: `${icon('refresh')}<span>Fetch from provider</span>` });
    const modelIdInput = h('input', { class: 'input', placeholder: 'e.g. gpt-4o, claude-sonnet-4, llama3.1:70b' });
    const nameInput = h('input', { class: 'input', placeholder: 'Display name, e.g. GPT-4o' });
    const ctxInput = h('input', { class: 'input', type: 'number', placeholder: 'Context window (tokens), e.g. 128000' });
    const maxOutInput = h('input', { class: 'input', type: 'number', placeholder: 'Max output tokens (optional)' });

    const capChecks = ['chat', 'vision', 'tools', 'reasoning', 'embeddings'].map((c) =>
      h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', value: c, checked: c === 'chat' }), h('span', { text: c }))
    );

    const remoteBox = h('div', { class: 'model-tags' });
    listBtn.addEventListener('click', async () => {
      listBtn.disabled = true;
      remoteBox.innerHTML = '';
      remoteBox.append(h('span', { class: 'faint', text: 'Fetching…' }));
      try {
        const res = await api.get(`/providers/${provider.id}/models`);
        remoteModels = res.models;
        remoteBox.innerHTML = '';
        if (!remoteModels.length) remoteBox.append(h('span', { class: 'faint', text: 'No models listed by this endpoint.' }));
        for (const m of remoteModels.slice(0, 40)) {
          remoteBox.append(
            h('button', {
              class: 'model-tag',
              text: m.id,
              onclick: () => {
                modelIdInput.value = m.id;
                if (!nameInput.value) nameInput.value = m.name || m.id;
              },
            })
          );
        }
      } catch (err) {
        remoteBox.innerHTML = '';
        remoteBox.append(h('span', { class: 'badge red', text: `Fetch failed: ${err.message}` }));
      }
      listBtn.disabled = false;
    });

    const modal = openModal({
      title: `Add model to ${provider.name}`,
      subtitle: 'Register a model you can select in chats and agents.',
      wide: true,
      body: [
        h('div', { class: 'field' }, h('label', {}, h('span', { text: 'Model ID ' }), h('span', { class: 'hint', text: '— from your provider, exactly as the API expects' })), modelIdInput),
        h('div', { class: 'row' }, listBtn, h('span', { class: 'hint', text: remoteModels.length ? 'Click a fetched model to prefill' : 'Try fetching the list from the provider API' })),
        remoteBox,
        h('div', { class: 'field' }, h('label', { text: 'Display name' }), nameInput),
        h('div', { class: 'row' }, h('div', { class: 'field', style: 'flex:1' }, h('label', { text: 'Context window' }), ctxInput), h('div', { class: 'field', style: 'flex:1' }, h('label', { text: 'Max output' }), maxOutInput)),
        h('div', { class: 'field' }, h('label', { text: 'Capabilities' }), h('div', { class: 'row', style: 'flex-wrap:wrap;gap:12px' }, capChecks)),
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h(
          'button',
          {
            class: 'btn primary',
            text: 'Add model',
            onclick: async () => {
              try {
                await api.post(`/providers/${provider.id}/models`, {
                  modelId: modelIdInput.value.trim(),
                  displayName: nameInput.value.trim() || modelIdInput.value.trim(),
                  contextWindow: ctxInput.value ? Number(ctxInput.value) : undefined,
                  maxOutputTokens: maxOutInput.value ? Number(maxOutInput.value) : undefined,
                  capabilities: capChecks.filter((c) => c.querySelector('input').checked).map((c) => c.querySelector('input').value),
                });
                await reload();
                modal.close();
                toast('Model added', 'success');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }
        ),
      ],
    });
    if (['openai', 'openai-compatible'].includes(provider.kind)) listBtn.click();
  }

  async function reload() {
    const [p, m] = await Promise.all([api.get('/providers'), api.get('/providers/meta')]);
    store.update({ providers: p.providers, models: p.models, providerKinds: m.kinds });
    render();
  }
  async function loadMeta() {
    const res = await api.get('/providers/meta');
    store.update({ providerKinds: res.kinds });
  }

  render();
  loadMeta();
  const onNew = () => addProviderModal();
  window.addEventListener('zeno:new-provider', onNew);
  return { destroy() { window.removeEventListener('zeno:new-provider', onNew); } };
}


export function providersSection() {
  const host = h('div', { class: 'settings-embed' });
  const mounted = mountProvidersView(host, { embedded: true });
  return { el: host, destroy: () => mounted?.destroy?.() };
}
