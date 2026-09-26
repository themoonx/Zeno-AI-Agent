


import { h, toast, confirmDialog, openModal, timeAgo } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';

function settingsRow(title, desc, control) {
  return h('div', { class: 'settings-row' },
    h('div', { class: 'sr-main' }, h('div', { class: 'sr-title', text: title }), h('div', { class: 'sr-desc', text: desc })),
    control
  );
}


export function permissionsPanel(host) {
  let destroyed = false;

  async function load() {
    let data = null;
    try {
      data = await api.get('/control/permissions');
    } catch (err) {
      host.append(h('div', { class: 'notice' }, h('span', { html: icon('alert') }), h('span', { text: err.message })));
      return;
    }
    if (destroyed) return;
    render(data);
  }

  function render(data) {
    host.innerHTML = '';

    
    const modeCards = h('div', { class: 'perm-mode-grid' },
      data.modes.map((m) =>
        h('button', {
          class: `perm-mode tone-${m.id === 'ask' ? 'amber' : m.id === 'workspace' ? 'blue' : 'red'}${data.mode === m.id ? ' is-active' : ''}`,
          onclick: async () => {
            try {
              await api.patch('/settings', { settings: { permission_mode: m.id } });
              store.update({ permissionMode: m.id });
              load();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
          h('span', { class: 'perm-mode-ico', html: icon(m.id === 'ask' ? 'shield' : m.id === 'workspace' ? 'shieldCheck' : 'shieldBolt') }),
          h('strong', { text: m.label }),
          h('span', { class: 'perm-mode-desc', text: m.description }))
      )
    );

    
    const ruleSubject = h('input', { class: 'input mono', placeholder: 'fs.write:C:/Users/you/Projects/**' });
    const ruleEffect = h('select', { class: 'select', style: 'width:110px' },
      h('option', { value: 'allow', text: 'Allow' }),
      h('option', { value: 'ask', text: 'Ask' }),
      h('option', { value: 'deny', text: 'Deny' })
    );
    const rulesList = h('div', { class: 'rules-list' });
    function renderRules(rules) {
      rulesList.innerHTML = '';
      if (!rules.length) {
        rulesList.append(h('p', { class: 'faint', style: 'padding:10px 2px', text: 'No rules. The active mode decides everything; add a rule to carve out exceptions (most specific rule wins).' }));
        return;
      }
      for (const r of rules) {
        rulesList.append(h('div', { class: 'rule-row' },
          h('span', { class: `badge ${r.effect === 'allow' ? 'accent' : r.effect === 'deny' ? 'red' : 'amber'}`, text: r.effect }),
          h('span', { class: 'mono ellipsis', style: 'flex:1;min-width:0', text: r.subject, title: r.subject }),
          h('button', {
            class: 'icon-btn danger', html: icon('trash'), title: 'Delete rule',
            onclick: async () => {
              try {
                await api.del(`/control/permissions/rules/${r.id}`);
                load();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          })
        ));
      }
    }
    renderRules(data.rules);

    
    const previewTool = h('select', { class: 'select', style: 'width:200px' },
      ...['terminal', 'code_exec', 'http_request', 'file_write', 'file_delete', 'local_write', 'web_search'].map((t) => h('option', { value: t, text: t })));
    const previewPath = h('input', { class: 'input mono', placeholder: 'C:/Users/you/Desktop/test.py (optional)', style: 'flex:1' });
    const previewOut = h('div', { class: 'perm-preview faint', text: '—' });
    async function runPreview() {
      try {
        const res = await api.post('/control/permissions/preview', { tool: previewTool.value, path: previewPath.value || undefined, mode: store.state.permissionMode });
        previewOut.className = `perm-preview verdict-${res.decision}`;
        previewOut.textContent = `${res.decision.toUpperCase()} — ${res.reason}`;
      } catch (err) {
        previewOut.className = 'perm-preview faint';
        previewOut.textContent = err.message;
      }
    }
    previewTool.addEventListener('change', runPreview);
    previewPath.addEventListener('input', () => { clearTimeout(previewOut._t); previewOut._t = setTimeout(runPreview, 350); });
    setTimeout(runPreview, 60);

    host.append(
      h('div', { class: 'settings-panel' },
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Permission mode' })),
        modeCards,
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Rules' }),
          h('p', { class: 'faint', style: 'margin:4px 0 10px;font-size:var(--fs-sm)' },
            'Refine the mode per resource. Subject = action class + pattern: ',
            h('code', { class: 'mono', text: 'fs.write' }), ' · ', h('code', { class: 'mono', text: 'fs.read' }), ' · ', h('code', { class: 'mono', text: 'fs.delete' }), ' · ',
            h('code', { class: 'mono', text: 'shell.exec' }), ' · ', h('code', { class: 'mono', text: 'net.request' }), ' · ', h('code', { class: 'mono', text: 'mcp' }), ' · ', h('code', { class: 'mono', text: 'plugin' }),
            ' + : + resource (supports * and **).')),
        h('div', { class: 'card', style: 'padding:14px 16px' },
          h('div', { class: 'row', style: 'gap:8px' }, ruleSubject, ruleEffect,
            h('button', {
              class: 'btn primary sm', html: `${icon('plus')}<span>Add rule</span>`,
              onclick: async () => {
                if (!ruleSubject.value.trim()) return toast('Enter a subject first', 'error');
                try {
                  await api.post('/control/permissions/rules', { subject: ruleSubject.value.trim(), effect: ruleEffect.value });
                  ruleSubject.value = '';
                  load();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            })),
          h('div', { style: 'margin-top:12px' }, rulesList)),
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'What would happen?' })),
        h('div', { class: 'card', style: 'padding:6px 16px' },
          settingsRow('Decision preview', 'What the policy engine would do for this call right now.', h('span', { class: 'faint', text: '' })),
          h('div', { class: 'row', style: 'gap:8px;padding:6px 0 14px' }, previewTool, previewPath),
          previewOut))
    );
  }

  load();
  return { destroy() { destroyed = true; } };
}


export function environmentsPanel(host) {
  let destroyed = false;

  async function load() {
    let data = null;
    try {
      data = await api.get('/control/environments');
    } catch (err) {
      host.append(h('div', { class: 'notice' }, h('span', { html: icon('alert') }), h('span', { text: err.message })));
      return;
    }
    if (destroyed) return;
    render(data);
  }

  function render(data) {
    host.innerHTML = '';
    const nameInput = h('input', { class: 'input', placeholder: 'e.g. My laptop', style: 'width:200px' });
    const rootsInput = h('input', { class: 'input mono', placeholder: 'C:\\Users\\you\\Desktop;C:\\Users\\you\\Documents', style: 'flex:1' });

    const agentsList = h('div', { class: 'rules-list' });
    if (!data.agents.length) {
      agentsList.append(h('p', { class: 'faint', style: 'padding:10px 2px', text: 'No local agents paired yet.' }));
    }
    for (const a of data.agents) {
      agentsList.append(h('div', { class: `rule-row${a.online ? ' is-online' : ''}` },
        h('span', { class: `badge ${a.status === 'active' ? (a.online ? 'accent' : '') : 'red'}`, text: a.online ? 'online' : a.status }),
        h('strong', { text: a.name, style: 'min-width:0' }),
        a.roots?.length ? h('span', { class: 'mono faint ellipsis', style: 'flex:1;min-width:0', text: a.roots.join('  '), title: a.roots.join('\n') }) : h('span', { class: 'spacer' }),
        a.lastSeenAt ? h('span', { class: 'faint', style: 'font-size:var(--fs-xs)', text: `seen ${timeAgo(a.lastSeenAt)}` }) : null,
        h('button', {
          class: 'icon-btn danger', html: icon('trash'), title: 'Revoke pairing',
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Revoke this agent?', message: `The pairing token for "${a.name}" stops working immediately.`, confirmLabel: 'Revoke', danger: true }))) return;
            try {
              await api.del(`/control/environments/agents/${a.id}`);
              load();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        })
      ));
    }

    host.append(
      h('div', { class: 'settings-panel' },
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Execution environments' })),
        h('div', { class: 'card', style: 'padding:6px 20px' },
          settingsRow('Workspace', 'Per-user private directory — always available. File tools operate here by default.', h('span', { class: 'badge accent', text: 'active' })),
          settingsRow('Server bridge', data.serverBridge.enabled ? `Server-side access to the machine Zeno runs on. ${data.serverBridge.hint}` : 'Disabled. Enable with ZENO_LOCAL_BRIDGE=1 and ZENO_LOCAL_ROOTS on the Zeno server.', h('span', { class: `badge ${data.serverBridge.enabled ? 'accent' : ''}`, text: data.serverBridge.enabled ? 'active' : 'off' })),
          settingsRow('Docker sandbox', 'Terminal/code tools route to a throwaway container when ZENO_SANDBOX_URL is set.', h('span', { class: 'badge', text: store.state.sandboxMode === 'docker' ? 'docker' : 'local' }))
        ),
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Local agents' }),
          h('p', { class: 'faint', style: 'margin:4px 0 10px;font-size:var(--fs-sm)', text: 'Pair your computer for local file access from a web deployment: the agent daemon connects outward to this server and only touches the roots you allow. Pairing also respects the permission modes.' })),
        h('div', { class: 'card', style: 'padding:14px 16px' },
          h('div', { class: 'row', style: 'gap:8px' }, nameInput, rootsInput,
            h('button', {
              class: 'btn primary sm', html: `${icon('plus')}<span>Pair</span>`,
              onclick: async () => {
                if (!nameInput.value.trim()) return toast('Give the agent a name', 'error');
                try {
                  const res = await api.post('/control/environments/agents', { name: nameInput.value.trim(), roots: rootsInput.value.trim() || undefined });
                  pairingModal(res);
                  load();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            })),
          h('div', { style: 'margin-top:12px' }, agentsList)))
    );
  }

  function pairingModal(res) {
    openModal({
      title: `Paired: ${res.agent.name}`,
      subtitle: 'Run this on your machine — the token is shown only once.',
      body: h('div', {},
        h('pre', { class: 'mono pairing-cmd', text: res.connect }),
        h('p', { class: 'faint', style: 'font-size:var(--fs-sm)', text: 'The daemon connects outward over WebSocket, confines every path to the roots you set, and can be revoked here at any time. Add --allow-shell when you want terminal access on your machine.' })
      ),
    });
  }

  load();
  return { destroy() { destroyed = true; } };
}


export function securityPanel(host) {
  let destroyed = false;

  async function load() {
    let sessions = [];
    let audit = [];
    try {
      sessions = (await api.get('/control/security/sessions')).sessions || [];
      audit = (await api.get('/control/security/audit?limit=100')).entries || [];
    } catch (err) {
      host.append(h('div', { class: 'notice' }, h('span', { html: icon('alert') }), h('span', { text: err.message })));
      return;
    }
    if (destroyed) return;

    host.append(
      h('div', { class: 'settings-panel' },
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Active sessions' })),
        h('div', { class: 'card audit-list', style: 'padding:10px 16px' },
          sessions.length ? sessions.map((s) => h('div', { class: 'audit-row' },
            h('span', { class: 'a-action ellipsis', style: 'max-width:340px', title: s.id, text: (s.userAgent || 'unknown client').slice(0, 60) }),
            h('span', { class: 'a-time', text: `started ${timeAgo(s.createdAt)}` }),
            h('button', {
              class: 'icon-btn danger', html: icon('x'), title: 'Revoke session',
              onclick: async () => {
                try {
                  await api.del(`/control/security/sessions/${s.id}`);
                  toast('Session revoked', 'success');
                  host.innerHTML = '';
                  load();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            })
          )) : h('p', { class: 'faint', text: 'No active sessions found.' })),
        h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Audit log' }),
          h('p', { class: 'faint', style: 'margin:4px 0 10px;font-size:var(--fs-sm)', text: 'Security-relevant actions: approvals, permission-mode changes, policy rules, local agent pairing, settings changes.' })),
        h('div', { class: 'card audit-list', style: 'padding:10px 16px;max-height:420px;overflow-y:auto' },
          audit.length ? audit.map((e) => h('div', { class: 'audit-row' },
            h('span', { class: `a-action${/deny|revoke|delete|remove/i.test(e.action) ? ' is-danger' : ''}`, text: e.action }),
            h('span', { class: 'a-time', text: new Date(e.ts).toLocaleString() })
          )) : h('p', { class: 'faint', text: 'Nothing yet.' }))
      )
    );
  }

  load();
  return { destroy() { destroyed = true; } };
}


export function workspacesPanel(host) {
  const projects = store.state.projects;
  host.append(
    h('div', { class: 'settings-panel' },
      h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Workspaces' }),
        h('p', { class: 'faint', style: 'margin:4px 0 10px;font-size:var(--fs-sm)', text: 'Each project is a workspace: conversations, memory, and files group under it, and its system prompt applies to every chat inside. Open a project to edit its scope.' })),
      h('div', { class: 'card-grid' },
        projects.length ? projects.map((p) =>
          h('a', { class: 'card hoverable project-card', href: '#/projects', style: 'text-decoration:none' },
            h('div', { class: 'pj-color', style: `background:${p.color || '#8B5CF6'}` }),
            h('div', { class: 'pj-name', text: p.name }),
            h('div', { class: 'pj-desc', text: p.description || 'No description.' }))) : null,
        !projects.length ? h('p', { class: 'faint', style: 'padding:10px 2px' }, 'No workspaces yet. ', h('a', { href: '#/projects', text: 'Create one →' })) : null),
      h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: 'Scope of a workspace' })),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Conversations & files', 'Grouped under the project; memory retrieval prefers project-scoped entries.', h('span', { class: 'badge', text: 'today' })),
        settingsRow('System prompt', 'Applies to every chat inside the workspace.', h('span', { class: 'badge', text: 'today' })),
        settingsRow('Default permission mode', 'Per-workspace permission defaults land here as the policy engine matures.', h('span', { class: 'badge', text: 'planned' })),
        settingsRow('Tool & connection scoping', 'Restrict which capabilities a workspace may use.', h('span', { class: 'badge', text: 'planned' }))
      )
    )
  );
  return { destroy() {} };
}
