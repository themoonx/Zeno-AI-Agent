


import { h, toast, confirmDialog, openModal, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { api } from '../api.js';

const KIND_META = {
  http: { label: 'HTTP plugin', hint: 'A fixed endpoint that receives the arguments the model fills in.' },
  mcp: { label: 'MCP server', hint: 'A remote Model Context Protocol server over streamable HTTP.' },
};

const SAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "What to look up" }
  },
  "required": ["query"]
}`;


export function connectionsSection({ onChange = null } = {}) {
  const root = h('div', { class: 'settings-panel-body' });
  let connectors = [];
  let loading = true;

  function render() {
    root.replaceChildren();

    root.append(
      h('div', { class: 'settings-panel-head' },
        h('div', {},
          h('h2', { text: 'Connections' }),
          h('p', { class: 'muted', text: 'Bring your own MCP servers and HTTP plugins. Zeno discovers their tools and can call them mid-conversation. Every call is approval-gated and confined to public Internet hosts.' })
        ),
        h('button', { class: 'btn primary', html: `${icon('plus')}<span>Add connection</span>`, onclick: () => connectorModal() })
      )
    );

    if (loading) {
      root.append(h('div', { class: 'skeleton', style: 'height:96px' }));
      return;
    }

    if (!connectors.length) {
      root.append(
        h('div', { class: 'empty' },
          h('div', { class: 'empty-icon', html: icon('plug') }),
          h('h3', { text: 'No connections yet' }),
          h('p', { text: 'Add an HTTP plugin or a remote MCP server to give the agent new abilities. Calls to them always ask for your approval first.' }),
          h('div', { class: 'empty-actions' }, h('button', { class: 'btn primary', html: `${icon('plus')}<span>Add connection</span>`, onclick: () => connectorModal() }))
        )
      );
      return;
    }

    const grid = h('div', { class: 'card-grid' });
    for (const c of connectors) grid.append(connectorCard(c));
    root.append(grid);
  }

  function connectorCard(c) {
    const meta = KIND_META[c.kind] || KIND_META.http;
    return h('div', { class: 'card provider-card' },
      h('div', { class: 'pc-head' },
        h('div', { class: 'pc-icon', text: c.kind === 'mcp' ? 'MCP' : 'HTTP' }),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'pc-title', text: c.name }),
          h('div', { class: 'pc-sub', title: c.endpoint, text: c.endpoint })
        ),
        statusBadge(c)
      ),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        h('span', { class: 'badge', text: meta.label }),
        c.toolName ? h('span', { class: 'badge accent', text: c.toolName }) : null,
        c.hasSecret ? h('span', { class: 'badge', html: `${icon('key')}<span>${c.secretMask || 'secret stored'}</span>` }) : h('span', { class: 'badge', text: 'no auth' }),
        c.enabled ? null : h('span', { class: 'badge amber', text: 'disabled' })
      ),
      c.statusDetail && c.status === 'error' ? h('p', { style: 'font-size:var(--fs-xs);color:var(--red);margin:0', text: c.statusDetail }) : null,
      h('div', { class: 'faint', style: 'font-size:var(--fs-xs)', text: `Updated ${timeAgo(c.updatedAt)}` }),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', {
          class: `btn sm ${c.enabled ? 'ghost' : 'primary'}`,
          html: `${icon(c.enabled ? 'xCircle' : 'checkCircle')}<span>${c.enabled ? 'Disable' : 'Enable'}</span>`,
          onclick: () => toggleEnabled(c),
        }),
        h('button', { class: 'btn sm ghost', html: `${icon('zap')}<span>Test</span>`, onclick: () => testConnector(c) }),
        h('button', { class: 'btn sm ghost', html: `${icon('edit')}<span>Edit</span>`, onclick: () => connectorModal(c) }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'icon-btn danger',
          title: 'Delete connection',
          html: icon('trash'),
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Delete connection?', message: `"${c.name}" will be removed and its tool will stop appearing in chat.`, confirmLabel: 'Delete', danger: true }))) return;
            try {
              await api.del(`/connectors/${c.id}`);
              toast('Connection deleted', 'success');
              await load();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        })
      )
    );
  }

  function statusBadge(c) {
    if (!c.enabled) return h('span', { class: 'badge', text: 'off' });
    const map = { connected: ['accent', 'connected'], error: ['red', 'error'] };
    const [cls, label] = map[c.status] || ['', 'not tested'];
    return h('span', { class: `badge ${cls}`, text: label });
  }

  async function toggleEnabled(c) {
    try {
      await api.patch(`/connectors/${c.id}/enabled`, { enabled: !c.enabled });
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function testConnector(c) {
    toast(`Testing ${c.name}…`, 'info', { timeout: 1500 });
    try {
      const res = await api.post(`/connectors/${c.id}/test`);
      const count = res.tools?.length || 0;
      toast(`${c.name}: reachable — ${count} tool${count === 1 ? '' : 's'} exposed`, 'success');
      if (res.transports?.unsupported?.length) {
        toast(`Unsupported transports: ${res.transports.unsupported.join(', ')}`, 'info', { timeout: 7000 });
      }
      await load();
    } catch (err) {
      toast(err.message, 'error');
      await load();
    }
  }

  function connectorModal(existing = null) {
    const isEdit = !!existing;
    let kind = existing?.kind || 'http';
    const nameInput = h('input', { class: 'input', value: existing?.name || '', placeholder: 'e.g. Weather API, Company MCP' });
    const endpointInput = h('input', { class: 'input', value: existing?.endpoint || '', placeholder: 'https://api.example.com/tool' });
    const secretInput = h('input', { class: 'input', type: 'password', placeholder: isEdit && existing.hasSecret ? 'Leave empty to keep the current secret' : 'Bearer token or API key (optional)' });
    const toolNameInput = h('input', { class: 'input', value: existing?.toolName || '', placeholder: 'e.g. weather_lookup' });
    const toolDescInput = h('input', { class: 'input', value: existing?.toolDescription || '', placeholder: 'Tells the model when to use this tool' });
    const schemaInput = h('textarea', { class: 'textarea', rows: '7', placeholder: SAMPLE_SCHEMA });
    const headersInput = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Optional extra headers as JSON' });
    if (existing?.schemaSpec) schemaInput.value = JSON.stringify(existing.schemaSpec, null, 2);
    if (Object.keys(existing?.headers || {}).length) headersInput.value = JSON.stringify(existing.headers);
    const errorBox = h('div', { class: 'form-error', hidden: true });

    const httpFields = h('div', {},
      h('div', { class: 'field' }, h('label', { text: 'Tool name' }), toolNameInput, h('span', { class: 'hint', text: 'Lowercase snake_case. This is how the model refers to it.' })),
      h('div', { class: 'field' }, h('label', { text: 'When to use it' }), toolDescInput),
      h('div', { class: 'field' }, h('label', { text: 'Arguments (JSON Schema)' }), schemaInput, h('span', { class: 'hint', text: 'The model fills exactly this shape; it cannot change the endpoint or method.' }))
    );
    const kindSelect = h('select',
      { class: 'select', disabled: isEdit, onchange: (e) => { kind = e.target.value; syncKind(); } },
      h('option', { value: 'http', selected: kind === 'http', text: KIND_META.http.label }),
      h('option', { value: 'mcp', selected: kind === 'mcp', text: KIND_META.mcp.label })
    );
    const kindHint = h('span', { class: 'hint' });
    function syncKind() {
      kindHint.textContent = isEdit ? 'The connection type cannot be changed after it is created.' : KIND_META[kind].hint;
      httpFields.style.display = kind === 'http' ? '' : 'none';
    }

    const modal = openModal({
      title: isEdit ? `Edit ${existing.name}` : 'Add connection',
      subtitle: 'Connections are private to your account. Secrets are encrypted before storage; requests only reach public Internet hosts.',
      wide: true,
      body: [
        errorBox,
        h('div', { class: 'field' }, h('label', { text: 'Type' }), kindSelect, kindHint),
        h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
        h('div', { class: 'field' }, h('label', { text: 'Endpoint URL' }), endpointInput),
        h('div', { class: 'field' }, h('label', { text: 'Secret' }), secretInput),
        httpFields,
        h('div', { class: 'field' }, h('label', { text: 'Extra headers (optional)' }), headersInput),
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h('button', { class: 'btn primary', text: isEdit ? 'Save' : 'Add connection', onclick: submit }),
      ],
    });
    syncKind();

    function fail(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }

    async function submit() {
      errorBox.hidden = true;
      const body = { name: nameInput.value.trim(), endpoint: endpointInput.value.trim() };
      if (!body.name) return fail('Name is required');
      if (!body.endpoint) return fail('Endpoint URL is required');
      if (secretInput.value.trim()) body.secret = secretInput.value.trim();
      if (headersInput.value.trim()) {
        try {
          body.headers = JSON.parse(headersInput.value);
        } catch {
          return fail('Headers must be valid JSON');
        }
      }
      if (kind === 'http') {
        body.toolName = toolNameInput.value.trim();
        body.toolDescription = toolDescInput.value.trim() || undefined;
        if (!body.toolName) return fail('Tool name is required');
        try {
          body.schemaSpec = schemaInput.value.trim() ? JSON.parse(schemaInput.value) : { type: 'object', properties: {} };
        } catch {
          return fail('Arguments must be valid JSON Schema');
        }
      }
      try {
        if (isEdit) await api.patch(`/connectors/${existing.id}`, body);
        else await api.post('/connectors', { kind, ...body });
        modal.close();
        toast(isEdit ? 'Connection updated' : 'Connection added', 'success');
        await load();
      } catch (err) {
        fail(err.message);
      }
    }
  }

  async function load() {
    try {
      const res = await api.get('/connectors');
      connectors = res.connectors || [];
    } catch (err) {
      connectors = [];
      toast(err.message, 'error');
    }
    loading = false;
    render();
    onChange?.();
  }

  render();
  load();
  return { el: root, reload: load, destroy() {} };
}