


import { h, toast, confirmDialog, openModal } from '../ui.js';
import { icon } from '../icons.js';
import { api } from '../api.js';

const ORIGIN_BADGE = {
  core: ['', 'built-in'],
  connector: ['blue', 'connection'],
  plugin: ['violet', 'plugin'],
};

const NEW_SKILL_TEMPLATE = `# What this skill does

Describe the method the agent should follow, step by step.

## Rules
- Be specific about what to check and in what order.
- State the output format you expect.`;


export function capabilitiesSection({ onChange = null } = {}) {
  const root = h('div', { class: 'settings-panel-body' });
  let snapshot = null;
  let loading = true;
  let tab = 'tools';

  const TABS = [
    ['tools', 'Tools'],
    ['skills', 'Skills'],
    ['plugins', 'Plugins'],
    ['orchestration', 'Orchestration'],
  ];

  async function load() {
    try {
      snapshot = await api.get('/harness');
    } catch (err) {
      snapshot = null;
      toast(err.message, 'error');
    }
    loading = false;
    render();
    onChange?.();
  }

  function render() {
    root.replaceChildren();
    if (loading) {
      root.append(h('div', { class: 'skeleton', style: 'height:140px' }));
      return;
    }
    if (!snapshot) {
      root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-icon', html: icon('alert') }), h('h3', { text: 'Capability catalog unavailable' }), h('p', { text: 'The harness could not be loaded. Reload the page or check the server logs.' })));
      return;
    }

    const { counts } = snapshot;
    root.append(
      h('div', { class: 'settings-panel-head' },
        h('div', {},
          h('h2', { text: 'Tools & capabilities' }),
          h('p', { class: 'muted', text: 'Everything the agent can use — and how it chooses. The harness orchestrates these automatically for each request; the model decides what to actually call.' })
        )
      ),
      h('div', { class: 'stat-strip' },
        stat('Tools', counts.tools, `${counts.core} built-in · ${counts.connectors} from connections · ${counts.pluginTools} from plugins`),
        stat('Skills', counts.skills, `${counts.builtinSkills} built-in · ${counts.userSkills} yours`),
        stat('Plugins', counts.plugins, `${counts.builtinPlugins} built-in packs`),
        stat('Connections', counts.mcpServers + counts.httpPlugins, `${counts.mcpServers} MCP · ${counts.httpPlugins} HTTP`)
      ),
      h('div', { class: 'tabs', role: 'tablist' },
        ...TABS.map(([id, label]) => h('button', {
          class: `tab${tab === id ? ' is-active' : ''}`,
          role: 'tab',
          'aria-selected': String(tab === id),
          text: label,
          onclick: () => { tab = id; render(); },
        }))
      )
    );

    if (tab === 'tools') root.append(toolsPanel());
    else if (tab === 'skills') root.append(skillsPanel());
    else if (tab === 'plugins') root.append(pluginsPanel());
    else root.append(orchestrationPanel());
  }

  function stat(label, value, sub) {
    return h('div', { class: 'stat-card' },
      h('div', { class: 'stat-value', text: String(value) }),
      h('div', { class: 'stat-label', text: label }),
      h('div', { class: 'stat-sub', text: sub })
    );
  }

  
  function toolsPanel() {
    const panel = h('div', { class: 'settings-panel' });
    const groups = new Map();
    for (const t of snapshot.tools) {
      const label = t.origin.kind === 'connector' ? 'Your connections' : t.origin.kind === 'plugin' ? 'Plugins' : t.origin.label;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(t);
    }
    for (const [label, list] of groups) {
      panel.append(
        h('div', { class: 'cap-group' },
          h('div', { class: 'cap-group-head' }, h('h3', { text: label }), h('span', { class: 'faint', text: `${list.length}` })),
          h('div', { class: 'cap-list' }, ...list.map(toolRow))
        )
      );
    }
    return panel;
  }

  function toolRow(t) {
    const [badgeCls, badgeLabel] = ORIGIN_BADGE[t.origin.kind] || ['', 'built-in'];
    const toggle = h('input', { type: 'checkbox', checked: t.enabled });
    toggle.addEventListener('change', () => setToolEnabled(t.name, toggle.checked));
    return h('div', { class: `cap-row${t.enabled ? '' : ' is-off'}` },
      h('span', { class: 'cap-icon', html: icon(toolIcon(t.name)) }),
      h('div', { class: 'cap-main' },
        h('div', { class: 'cap-title' },
          h('span', { class: 'cap-name', text: t.displayName || t.name }),
          t.displayName && t.displayName !== t.name ? h('span', { class: 'mono faint', style: 'font-size:var(--fs-xs)', text: t.name }) : null,
          h('span', { class: 'badge', text: badgeLabel }),
          t.sensitive ? h('span', { class: 'badge amber', text: 'approval' }) : null
        ),
        h('div', { class: 'cap-desc', text: t.description || '' })
      ),
      h('label', { class: 'cap-toggle', title: t.enabled ? 'Disable this tool' : 'Enable this tool' },
        toggle, h('span', { class: 'visually-hidden', text: `Enable ${t.displayName || t.name}` }))
    );
  }

  async function setToolEnabled(name, enabled) {
    const disabled = new Set(snapshot.settings.disabled_tools || []);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    try {
      const res = await api.patch('/harness/settings', { settings: { disabled_tools: [...disabled] } });
      snapshot.settings = res.settings;
      await load();
    } catch (err) {
      toast(err.message, 'error');
      await load();
    }
  }

  
  function skillsPanel() {
    const panel = h('div', { class: 'settings-panel' });
    const skills = snapshot.skills || [];
    const { builtinSkills, userSkills } = snapshot.counts;

    panel.append(
      h('div', { class: 'panel-toolbar' },
        h('span', { class: 'faint', text: `${builtinSkills} built-in · ${userSkills} yours · matched automatically per request` }),
        h('button', { class: 'btn primary sm', html: `${icon('plus')}<span>New skill</span>`, onclick: () => skillModal() })
      ),
      h('div', { class: 'cap-list' }, ...skills.map(skillRow))
    );
    return panel;
  }

  function skillRow(s) {
    const toggle = h('input', { type: 'checkbox', checked: s.enabled });
    toggle.addEventListener('change', () => setSkillEnabled(s, toggle.checked));
    const builtin = s.source === 'builtin';
    return h('div', { class: `cap-row cap-row-skill${s.enabled ? '' : ' is-off'}` },
      h('span', { class: 'cap-icon', html: icon(builtin ? 'sparkles' : 'edit') }),
      h('div', { class: 'cap-main' },
        h('div', { class: 'cap-title' },
          h('strong', { text: s.name }),
          h('span', { class: `badge ${builtin ? '' : 'violet'}`, text: builtin ? 'built-in' : s.source === 'plugin' ? 'plugin' : 'yours' }),
          (s.tools || []).slice(0, 4).map((tl) => h('span', { class: 'badge', text: tl }))
        ),
        h('div', { class: 'cap-desc', text: s.description || '' }),
        (s.triggers || []).length ? h('div', { class: 'cap-triggers', text: `Triggers: ${s.triggers.join(', ')}` }) : null
      ),
      h('div', { class: 'cap-actions' },
        h('button', { class: 'btn sm ghost', text: 'View', onclick: () => skillModal(s) }),
        builtin ? null : h('button', {
          class: 'icon-btn danger', title: 'Delete skill', html: icon('trash'),
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Delete skill?', message: `"${s.name}" will stop being available to the agent.`, confirmLabel: 'Delete', danger: true }))) return;
            try {
              await api.del(`/harness/skills/${s.id}`);
              toast('Skill deleted', 'success');
              await load();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        })
      ),
      h('label', { class: 'cap-toggle', title: s.enabled ? 'Disable' : 'Enable' },
        toggle, h('span', { class: 'visually-hidden', text: `Enable ${s.name}` }))
    );
  }

  async function setSkillEnabled(s, enabled) {
    try {
      if (s.source === 'user') await api.patch(`/harness/skills/${s.id}/enabled`, { enabled });
      
      const key = 'disabled_skills';
      const current = new Set((snapshot.settings[key] || []));
      if (enabled) current.delete(s.slug);
      else current.add(s.slug);
      const res = await api.patch('/harness/settings', { settings: { [key]: [...current] } });
      snapshot.settings = res.settings;
      await load();
    } catch (err) {
      toast(err.message, 'error');
      await load();
    }
  }

  function skillModal(existing = null) {
    const isEdit = !!existing && existing.source === 'user';
    const builtin = existing?.source === 'builtin';
    const nameInput = h('input', { class: 'input', value: existing?.name || '', placeholder: 'e.g. Release Notes', disabled: builtin || isEdit });
    const descInput = h('textarea', { class: 'textarea', rows: '2', value: existing?.description || '', placeholder: 'When should the agent use this skill?' });
    const triggersInput = h('input', { class: 'input', value: (existing?.triggers || []).join(', '), placeholder: 'comma, separated, keywords' });
    const instructionsInput = h('textarea', { class: 'textarea', rows: '14', value: existing?.instructions || NEW_SKILL_TEMPLATE });
    instructionsInput.style.fontFamily = 'var(--mono)';
    instructionsInput.style.fontSize = 'var(--fs-sm)';
    const errorBox = h('div', { class: 'form-error', hidden: true });

    const readOnly = builtin;
    const body = [
      errorBox,
      builtin ? h('p', { class: 'hint', text: 'Built-in skills ship with Zeno and cannot be edited. Create your own skill to customise this behaviour.' }) : null,
      h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
      h('div', { class: 'field' }, h('label', { text: 'Description' }), descInput, h('span', { class: 'hint', text: 'Shown to the model so it knows when this skill applies.' })),
      h('div', { class: 'field' }, h('label', { text: 'Trigger keywords' }), triggersInput, h('span', { class: 'hint', text: 'Comma-separated. When a request matches, the instructions below are loaded automatically.' })),
      h('div', { class: 'field' }, h('label', { text: 'Instructions' }), instructionsInput),
    ];
    if (readOnly) {
      nameInput.disabled = true;
      descInput.disabled = true;
      triggersInput.disabled = true;
      instructionsInput.disabled = true;
    }

    let modal = null;
    const footer = readOnly
      ? [h('button', { class: 'btn ghost', text: 'Close', onclick: () => modal.close() }),
         h('button', { class: 'btn primary', text: 'Duplicate as my skill', onclick: () => { modal.close(); skillModal({ ...existing, id: null, source: 'user' }); } })]
      : [h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
         h('button', { class: 'btn primary', text: isEdit ? 'Save' : 'Create skill', onclick: submit })];

    modal = openModal({
      title: existing ? (builtin ? `${existing.name} (built-in)` : `Edit ${existing.name}`) : 'New skill',
      subtitle: 'Skills are reusable instructions the agent adopts for matching requests.',
      wide: true,
      body,
      footer,
    });

    async function submit() {
      errorBox.hidden = true;
      const payload = {
        name: nameInput.value.trim(),
        description: descInput.value.trim(),
        instructions: instructionsInput.value.trim(),
        triggers: triggersInput.value.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (!payload.name) { errorBox.textContent = 'Name is required'; errorBox.hidden = false; return; }
      if (payload.instructions.length < 10) { errorBox.textContent = 'Instructions must be at least 10 characters'; errorBox.hidden = false; return; }
      try {
        if (isEdit) await api.patch(`/harness/skills/${existing.id}`, payload);
        else await api.post('/harness/skills', payload);
        modal.close();
        toast(isEdit ? 'Skill saved' : 'Skill created', 'success');
        await load();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    }
  }

  
  function pluginsPanel() {
    const panel = h('div', { class: 'settings-panel' });
    const packs = snapshot.packs || [];
    const plugins = snapshot.plugins || [];

    panel.append(
      h('div', { class: 'panel-toolbar' },
        h('span', { class: 'faint', text: 'A plugin bundles tools, skills and guidance into one installable capability.' }),
        h('button', { class: 'btn primary sm', html: `${icon('plus')}<span>Install plugin</span>`, onclick: () => pluginModal() })
      ),
      h('div', { class: 'cap-group' },
        h('div', { class: 'cap-group-head' }, h('h3', { text: 'Built-in packs' }), h('span', { class: 'faint', text: `${packs.length}` })),
        h('div', { class: 'cap-list' }, ...packs.map(packRow))
      )
    );

    const userPlugins = plugins.filter((p) => !p.builtin);
    panel.append(
      h('div', { class: 'cap-group' },
        h('div', { class: 'cap-group-head' }, h('h3', { text: 'Installed plugins' }), h('span', { class: 'faint', text: `${userPlugins.length}` })),
        userPlugins.length
          ? h('div', { class: 'cap-list' }, ...userPlugins.map(pluginRow))
          : h('p', { class: 'faint', style: 'padding:8px 2px;margin:0', text: 'No plugins installed. Install one to add your own tools and skills.' })
      )
    );
    return panel;
  }

  function packRow(p) {
    return h('div', { class: 'cap-row' },
      h('span', { class: 'cap-icon', html: icon('zap') }),
      h('div', { class: 'cap-main' },
        h('div', { class: 'cap-title' }, h('strong', { text: p.name }), h('span', { class: 'badge accent', text: 'built-in' }), h('span', { class: 'badge', text: `v${p.version}` })),
        h('div', { class: 'cap-desc', text: p.description }),
        h('div', { class: 'cap-triggers' },
          p.tools.length ? `Tools: ${p.tools.join(', ')}` : null,
          p.tools.length && p.skills.length ? ' · ' : null,
          p.skills.length ? `Skills: ${p.skills.join(', ')}` : null
        )
      )
    );
  }

  function pluginRow(p) {
    const toggle = h('input', { type: 'checkbox', checked: p.enabled });
    toggle.addEventListener('change', async () => {
      try {
        await api.patch(`/harness/plugins/${p.id}/enabled`, { enabled: toggle.checked });
        await load();
      } catch (err) {
        toast(err.message, 'error');
        await load();
      }
    });
    return h('div', { class: `cap-row${p.enabled ? '' : ' is-off'}` },
      h('span', { class: 'cap-icon', html: icon('plug') }),
      h('div', { class: 'cap-main' },
        h('div', { class: 'cap-title' },
          h('strong', { text: p.name }),
          h('span', { class: 'badge violet', text: 'yours' }),
          p.status === 'error' ? h('span', { class: 'badge red', text: 'error' }) : null
        ),
        h('div', { class: 'cap-desc', text: p.description || '' }),
        h('div', { class: 'cap-triggers', text: p.tools.map((t) => t.name).join(', ') || 'no tools' }),
        p.statusDetail ? h('div', { class: 'cap-desc', style: 'color:var(--red)', text: p.statusDetail }) : null
      ),
      h('div', { class: 'cap-actions' },
        h('button', { class: 'btn sm ghost', html: `${icon('zap')}<span>Test</span>`, onclick: async () => {
          try {
            await api.post(`/harness/plugins/${p.id}/test`);
            toast('Plugin endpoints reachable', 'success');
          } catch (err) {
            toast(err.message, 'error');
          }
          await load();
        } }),
        h('button', { class: 'icon-btn danger', title: 'Uninstall plugin', html: icon('trash'), onclick: async () => {
          if (!(await confirmDialog({ title: 'Uninstall plugin?', message: `"${p.name}" and its tools will stop being available to the agent.`, confirmLabel: 'Uninstall', danger: true }))) return;
          try {
            await api.del(`/harness/plugins/${p.id}`);
            toast('Plugin uninstalled', 'success');
            await load();
          } catch (err) {
            toast(err.message, 'error');
          }
        } })
      ),
      h('label', { class: 'cap-toggle', title: p.enabled ? 'Disable' : 'Enable' }, toggle, h('span', { class: 'visually-hidden', text: `Enable ${p.name}` }))
    );
  }

  function pluginModal() {
    const nameInput = h('input', { class: 'input', placeholder: 'e.g. Weather Kit' });
    const descInput = h('input', { class: 'input', placeholder: 'What does this plugin provide?' });
    const secretInput = h('input', { class: 'input', type: 'password', placeholder: 'Bearer token sent to every tool endpoint (optional)' });
    const manifestInput = h('textarea', { class: 'textarea', rows: '12', placeholder: PLUGIN_SAMPLE });
    manifestInput.style.fontFamily = 'var(--mono)';
    manifestInput.style.fontSize = 'var(--fs-sm)';
    const errorBox = h('div', { class: 'form-error', hidden: true });

    const modal = openModal({
      title: 'Install plugin',
      subtitle: 'Plugins are private to your account. Endpoints are fixed in the manifest — the model can never change where a request goes.',
      wide: true,
      body: [
        errorBox,
        h('div', { class: 'field' }, h('label', { text: 'Name' }), nameInput),
        h('div', { class: 'field' }, h('label', { text: 'Description' }), descInput),
        h('div', { class: 'field' }, h('label', { text: 'Shared secret' }), secretInput),
        h('div', { class: 'field' }, h('label', { text: 'Manifest (JSON)' }), manifestInput, h('span', { class: 'hint', text: 'Each tool gets an endpoint and a JSON Schema for its arguments. All plugin tools are approval-gated.' })),
      ],
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => modal.close() }),
        h('button', { class: 'btn primary', text: 'Install', onclick: submit }),
      ],
    });

    async function submit() {
      errorBox.hidden = true;
      let manifest;
      try {
        manifest = JSON.parse(manifestInput.value);
      } catch {
        errorBox.textContent = 'Manifest must be valid JSON';
        errorBox.hidden = false;
        return;
      }
      try {
        await api.post('/harness/plugins', {
          name: nameInput.value.trim(),
          description: descInput.value.trim(),
          secret: secretInput.value.trim() || undefined,
          manifest,
        });
        modal.close();
        toast('Plugin installed', 'success');
        await load();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      }
    }
  }

  
  function orchestrationPanel() {
    const s = snapshot.settings;
    const panel = h('div', { class: 'settings-panel' });

    const row = (title, desc, control) => h('div', { class: 'settings-row' },
      h('div', { class: 'sr-main' }, h('div', { class: 'sr-title', text: title }), h('div', { class: 'sr-desc', text: desc })),
      control
    );

    const boolToggle = (key) => {
      const input = h('input', { type: 'checkbox', checked: !!s[key] });
      input.addEventListener('change', () => save({ [key]: input.checked }));
      return h('label', { class: 'checkbox' }, input, h('span', { text: input.checked ? 'On' : 'Off' }));
    };

    const maxSkills = h('select', { class: 'select', onchange: (e) => save({ max_matched_skills: Number(e.target.value) }) },
      ...[0, 1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n), selected: Number(s.max_matched_skills) === n, text: n === 0 ? 'None' : `${n} skill${n === 1 ? '' : 's'}` }))
    );

    panel.append(
      h('div', { class: 'card', style: 'padding:6px 20px' },
        row('Automatic orchestration', 'Match skills and capabilities to each request before the model runs.', boolToggle('auto_orchestrate')),
        row('Automatic skill loading', 'Inject the instructions of matching skills into the request.', boolToggle('auto_skills')),
        row('Maximum loaded skills', 'How many skills may be loaded for one request.', maxSkills),
        row('Plugin tools', 'Offer tools contributed by plugin packs to the model.', boolToggle('plugin_tools')),
        row('Connection tools', 'Offer tools from your MCP servers and HTTP plugins.', boolToggle('connector_tools'))
      )
    );

    
    const probe = h('input', { class: 'input', placeholder: 'Type a request to preview orchestration…' });
    const result = h('div', { class: 'probe-result' });
    let timer = null;
    probe.addEventListener('input', () => {
      clearTimeout(timer);
      const q = probe.value.trim();
      if (!q) { result.replaceChildren(); return; }
      timer = setTimeout(async () => {
        try {
          const res = await api.post('/harness/skills/match', { query: q });
          result.replaceChildren(
            h('div', { class: 'probe-row' },
              h('span', { class: 'faint', text: 'Tools offered:' }),
              h('span', { class: `badge ${res.offerTools ? 'accent' : ''}`, text: res.offerTools ? 'yes' : 'no — answered directly' })
            ),
            h('div', { class: 'probe-row' },
              h('span', { class: 'faint', text: 'Skills matched:' }),
              res.matched.length
                ? h('span', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...res.matched.map((m) => h('span', { class: 'badge violet', text: `${m.name} (${m.score})` })))
                : h('span', { class: 'faint', text: 'none' })
            )
          );
        } catch (err) {
          result.replaceChildren(h('div', { class: 'faint', text: err.message }));
        }
      }, 350);
    });

    panel.append(
      h('div', { class: 'cap-group', style: 'margin-top:18px' },
        h('div', { class: 'cap-group-head' }, h('h3', { text: 'Preview orchestration' })),
        h('p', { class: 'faint', style: 'margin:0 0 10px', text: 'See exactly what the harness would load for a request. Nothing is executed.' }),
        probe, result
      )
    );
    return panel;
  }

  async function save(patch) {
    try {
      const res = await api.patch('/harness/settings', { settings: patch });
      snapshot.settings = res.settings;
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function toolIcon(name) {
    return {
      web_search: 'globe', browser_read: 'globe', http_request: 'external',
      file_read: 'file', file_list: 'folderOpen', file_write: 'edit', file_edit: 'edit', file_delete: 'trash',
      local_read: 'desktop', local_list: 'desktop', local_write: 'desktop', local_edit: 'desktop', local_delete: 'desktop',
      terminal: 'terminal', code_exec: 'code', memory_search: 'brain', memory_write: 'brain',
      skill_load: 'book',
    }[name] || (name.startsWith('mcp_') ? 'plug' : 'zap');
  }

  render();
  load();
  return { el: root, reload: load, destroy() {} };
}

const PLUGIN_SAMPLE = `{
  "tools": [
    {
      "name": "weather_lookup",
      "description": "Look up current weather for a city",
      "endpoint": "https://api.example.com/weather",
      "method": "POST",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  ]
}`;