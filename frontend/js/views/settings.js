












import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';
import { capabilitiesSection } from './harness.js';
import { connectionsSection } from './connectors.js';
import { providersSection } from './providers.js';
import { permissionsPanel, environmentsPanel, securityPanel, workspacesPanel } from './control.js';
import { intelligencePanel, costPanel } from './intelligence.js';

const TABS = [
  ['general', 'General', 'sliders'],
  ['intelligence', 'Intelligence', 'compass'],
  ['cost', 'Cost & Usage', 'layers'],
  ['permissions', 'Permissions', 'shield'],
  ['tools', 'Tools & capabilities', 'zap'],
  ['connections', 'Connections', 'plug'],
  ['providers', 'Providers & models', 'key'],
  ['environments', 'Environments', 'desktop'],
  ['workspaces', 'Workspaces', 'folder'],
  ['appearance', 'Appearance', 'eye'],
  ['security', 'Security', 'lock'],
  ['system', 'System', 'info'],
];

export function mountSettingsView(root, { tab = null } = {}) {
  const view = h('div', { class: 'view' }, h('div', { class: 'view-inner' }));
  root.append(view);
  const inner = view.querySelector('.view-inner');
  let active = TABS.some(([id]) => id === tab) ? tab : 'general';
  let destroyed = false;
  let mounted = null;

  function setTab(next, { push = true } = {}) {
    if (!TABS.some(([id]) => id === next)) next = 'general';
    active = next;
    mounted?.destroy?.();
    mounted = null;
    if (push) history.pushState(null, '', `#/settings${next === 'general' ? '' : '/' + next}`);
    render();
  }

  function render() {
    if (destroyed) return;
    inner.replaceChildren();
    inner.append(
      h('div', { class: 'view-head' }, h('h1', { text: 'Settings' }), h('p', { text: 'Workspace defaults, agent capabilities, and connections.' })),
      h('div', { class: 'settings-nav', role: 'tablist' },
        ...TABS.map(([id, label, glyph]) => h('button', {
          class: `settings-tab${active === id ? ' is-active' : ''}`,
          role: 'tab',
          'aria-selected': String(active === id),
          onclick: () => setTab(id),
        }, h('span', { html: icon(glyph) }), h('span', { text: label })))
      )
    );

    const panel = h('div', { class: 'settings-panel-host' });
    inner.append(panel);

    if (active === 'general') { mounted = generalPanel(panel); return; }
    if (active === 'intelligence') { mounted = intelligencePanel(panel); return; }
    if (active === 'cost') { mounted = costPanel(panel); return; }
    if (active === 'permissions') { mounted = permissionsPanel(panel); return; }
    if (active === 'tools') { mounted = capabilitiesSection({ onChange: () => {} }); panel.append(mounted.el); return; }
    if (active === 'connections') { mounted = connectionsSection({ onChange: () => {} }); panel.append(mounted.el); return; }
    if (active === 'providers') { mounted = providersSection({ embedded: true }); panel.append(mounted.el); return; }
    if (active === 'environments') { mounted = environmentsPanel(panel); return; }
    if (active === 'workspaces') { mounted = workspacesPanel(panel); return; }
    if (active === 'security') { mounted = securityPanel(panel); return; }
    if (active === 'appearance') { mounted = appearancePanel(panel); return; }
    mounted = systemPanel(panel);
  }

  function settingsRow(title, desc, control) {
    return h('div', { class: 'settings-row' },
      h('div', { class: 'sr-main' }, h('div', { class: 'sr-title', text: title }), h('div', { class: 'sr-desc', text: desc })),
      control
    );
  }

  function save(key, transform) {
    return async (e) => {
      try {
        const value = transform(e?.target?.value);
        await api.patch('/settings', { settings: { [key]: value } });
        const { loadSettings } = await import('../app.js');
        await loadSettings();
        toast('Saved', 'success', { timeout: 1200 });
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  
  function generalPanel(host) {
    const { settings, models } = store.state;
    const defaultModelSelect = h('select', { class: 'select', onchange: save('default_model', (v) => ({ modelId: v })) },
      h('option', { value: '', text: models.length ? 'First available model' : '— no models —' }),
      ...models.map((m) => h('option', { value: m.id, selected: settings.default_model?.modelId === m.id, text: m.displayName }))
    );

    const embeddingModels = models.filter((m) => (m.capabilities || []).includes('embeddings'));
    const embedSelect = h('select', { class: 'select', onchange: save('embedding_model', (v) => (v ? { modelId: v } : null)) },
      h('option', { value: '', text: 'None — keyword memory search', selected: !settings.embedding_model }),
      ...embeddingModels.map((m) => h('option', { value: m.id, selected: settings.embedding_model?.modelId === m.id, text: `${m.displayName} (${m.modelId})` }))
    );

    const autoMemCheck = h('input', { type: 'checkbox', checked: settings.auto_memory !== false });
    autoMemCheck.addEventListener('change', () => save('auto_memory', () => autoMemCheck.checked)());

    host.append(
      h('div', { class: 'settings-panel' },
        h('div', { class: 'card', style: 'padding:6px 20px' },
          settingsRow('Default model', 'Used for new chats when none is selected.', defaultModelSelect),
          settingsRow('Embeddings model', 'Enables semantic memory search.', embeddingModels.length ? embedSelect : h('span', { class: 'hint', text: 'Register an embeddings-capable model first (Providers → add model with the "embeddings" capability).' })),
          settingsRow('Automatic memory', 'Distill durable facts from conversations after they finish.', h('label', { class: 'checkbox' }, autoMemCheck, h('span', { text: 'Enabled' })))
        ),
        models.length ? null : h('div', { class: 'notice' },
          h('span', { html: icon('info') }),
          h('span', {}, 'No models yet. ', h('a', { href: '#/settings/providers', text: 'Add a provider and register a model →' }))
        )
      )
    );
    return { destroy() {} };
  }

  
  function appearancePanel(host) {
    const { settings } = store.state;
    const themeSelect = h('select', { class: 'select', onchange: (e) => { document.documentElement.dataset.theme = e.target.value; save('theme', (v) => v)(e); } },
      h('option', { value: 'dark', selected: (settings.theme || 'dark') === 'dark', text: 'Dark' }),
      h('option', { value: 'light', selected: settings.theme === 'light', text: 'Light' })
    );
    const densitySelect = h('select', { class: 'select', onchange: (e) => { document.documentElement.dataset.density = e.target.value; save('density', (v) => v)(e); } },
      h('option', { value: 'comfortable', selected: (settings.density || 'comfortable') === 'comfortable', text: 'Comfortable' }),
      h('option', { value: 'compact', selected: settings.density === 'compact', text: 'Compact' })
    );
    host.append(
      h('div', { class: 'settings-panel' },
        h('div', { class: 'card', style: 'padding:6px 20px' },
          settingsRow('Theme', 'Violet accents on a dark or light neutral canvas.', themeSelect),
          settingsRow('Density', 'Spacing of message lists and settings rows.', densitySelect)
        )
      )
    );
    return { destroy() {} };
  }

  
  function systemPanel(host) {
    const host2 = h('div', { class: 'settings-panel' });
    host.append(host2);
    (async () => {
      let health = null;
      let entries = [];
      let telemetry = null;
      try {
        health = await api.get('/health');
      } catch {  }
      try {
        entries = (await api.get('/settings/audit?limit=30')).entries || [];
      } catch {  }
      try {
        telemetry = (await api.get('/control/telemetry?sinceHours=24')).summary;
      } catch {  }
      if (destroyed) return;

      const telemetryCard = telemetry
        ? h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Agent telemetry (last 24h)' }),
            h('div', { class: 'card', style: 'padding:6px 20px' },
              settingsRow('Model calls', 'Model requests across chat, runs and reviews.', h('span', { class: 'badge', text: String(telemetry.modelCalls ?? 0) })),
              settingsRow('Avg model latency', telemetry.avgModelLatencyMs == null ? 'No calls in the window.' : 'Round-trip per completed model call.', h('span', { class: 'badge', text: telemetry.avgModelLatencyMs != null ? `${telemetry.avgModelLatencyMs} ms` : '—' })),
              settingsRow('Tokens', 'Prompt + completion tokens billed in the window.', h('span', { class: 'badge', text: `${(telemetry.promptTokens ?? 0).toLocaleString()} in · ${(telemetry.completionTokens ?? 0).toLocaleString()} out` })),
              settingsRow('Tool executions', `${telemetry.toolCalls ?? 0} executed, ${telemetry.toolFailures ?? 0} failed.`, h('span', { class: `badge ${telemetry.toolFailures ? 'red' : 'accent'}`, text: `${telemetry.toolCalls ?? 0}` })),
              ...(telemetry.byKind?.['permission.decision']
                ? [settingsRow('Permission decisions', 'Policy verdicts on sensitive actions (allow / ask / deny).', h('span', { class: 'badge', text: String(telemetry.byKind['permission.decision']) }))]
                : [])
            ))
        : null;

      host2.append(
        h('div', { class: 'card', style: 'padding:6px 20px' },
          settingsRow('Version', 'Zeno AI workspace + agent harness.', h('span', { class: 'badge', text: health?.version || '1.0.0' })),
          settingsRow('Database', health?.database === 'postgres' ? 'PostgreSQL (persistent, production)' : 'Embedded SQLite (data/zeno.db). Set DATABASE_URL for PostgreSQL.', h('span', { class: `badge ${health?.database === 'postgres' ? 'accent' : ''}`, text: health?.database || '—' })),
          settingsRow('Sandbox', health?.sandbox === 'docker' ? 'Docker-isolated execution' : 'Local restricted child processes. Set ZENO_SANDBOX_URL for container isolation.', h('span', { class: 'badge', text: health?.sandbox || '—' }))
        ),
        telemetryCard,
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Keyboard shortcuts' })),
        h('div', { class: 'card', style: 'padding:16px 20px' },
          h('div', { class: 'shortcut-grid' },
            ...[
              ['Command palette', ['Ctrl', 'K']],
              ['New conversation', ['Ctrl', 'N']],
              ['Toggle sidebar', ['Ctrl', 'B']],
              ['Focus composer', ['Ctrl', '/']],
              ['Stop generating', ['Esc']],
            ].flatMap(([label, keys]) => [
              h('span', { text: label }),
              h('div', { class: 'sc-keys' }, keys.map((k) => h('span', { class: 'kbd', text: k }))),
            ])
          )
        )
      );

      if (entries.length) {
        host2.append(
          h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Recent activity (audit log)' })),
          h('div', { class: 'card audit-list', style: 'padding:10px 16px' },
            entries.map((e) => h('div', { class: 'audit-row' },
              h('span', { class: 'a-action', text: e.action }),
              h('span', { class: 'a-time', text: new Date(e.ts).toLocaleString() })
            ))
          )
        );
      }
    })();
    return { destroy() {} };
  }

  render();
  return {
    destroy() {
      destroyed = true;
      mounted?.destroy?.();
    },
  };
}