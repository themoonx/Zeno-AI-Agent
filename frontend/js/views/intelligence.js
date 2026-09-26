




import { h, toast } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';

function settingsRow(title, desc, control) {
  return h('div', { class: 'settings-row' },
    h('div', { class: 'sr-main' }, h('div', { class: 'sr-title', text: title }), h('div', { class: 'sr-desc', text: desc })),
    control
  );
}

function section(title) {
  return h('div', { class: 'settings-section' }, h('h3', { class: 'panel-subhead', text: title }));
}

function money(n) {
  const v = Number(n) || 0;
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}


export function intelligencePanel(host) {
  let destroyed = false;
  const { settings } = store.state;
  const jev = settings.jev || {};
  const routing = settings.model_routing || {};
  const verification = settings.verification || {};
  const research = settings.research || {};

  async function patch(key, value) {
    try {
      await api.patch('/settings', { settings: { [key]: value } });
      toast('Saved', 'success', { timeout: 1200 });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  
  const jevEnabled = h('input', { type: 'checkbox', checked: jev.enabled !== false });
  jevEnabled.addEventListener('change', () => patch('jev', { enabled: jevEnabled.checked }));

  const floorInput = h('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.05', value: String(jev.confidence_floor ?? 0.6), style: 'width:110px' });
  const floorSave = () => patch('jev', { confidence_floor: Math.max(0, Math.min(1, Number(floorInput.value) || 0.6)) });
  floorInput.addEventListener('change', floorSave);

  const modeSelect = h('select', { class: 'select' },
    h('option', { value: 'json', selected: (jev.mode || 'json') === 'json', text: 'Custom endpoint (JSON decision API)' }),
    h('option', { value: 'openai', selected: jev.mode === 'openai', text: 'OpenAI-compatible model' })
  );
  const endpointInput = h('input', { class: 'input mono', placeholder: 'https://jev.internal/decide  ·  or  https://host/v1', value: jev.endpoint || '' });
  const modelInput = h('input', { class: 'input mono', placeholder: 'classifier-model (openai mode only)', value: jev.model || '' });
  const keyInput = h('input', { class: 'input mono', type: 'password', placeholder: jev.api_key === '__set__' ? '•••••••• (set — type to replace)' : 'API key (optional)' });
  const remoteSave = () => {
    const value = { endpoint: endpointInput.value.trim(), mode: modeSelect.value, model: modelInput.value.trim() };
    if (keyInput.value) value.api_key = keyInput.value;
    patch('jev', value);
  };
  for (const el of [modeSelect, endpointInput, modelInput]) el.addEventListener('change', remoteSave);
  keyInput.addEventListener('change', () => { remoteSave(); keyInput.value = ''; });

  
  const routingMode = h('select', { class: 'select' },
    h('option', { value: 'off', selected: routing.mode === 'off', text: 'Off — always use the conversation model' }),
    h('option', { value: 'aux', selected: (routing.mode || 'aux') === 'aux', text: 'Auxiliary only — route planning, summaries & verification (recommended)' }),
    h('option', { value: 'full', selected: routing.mode === 'full', text: 'Full — also route the main agent loop by task tier' })
  );
  routingMode.addEventListener('change', () => patch('model_routing', { mode: routingMode.value }));

  const TIERS = ['local', 'fast', 'balanced', 'reasoning', 'premium'];
  const tierSelect = (key, def) => {
    const sel = h('select', { class: 'select' },
      ...TIERS.map((t) => h('option', { value: t, selected: (routing[key] || def) === t, text: t }))
    );
    sel.addEventListener('change', () => patch('model_routing', { [key]: sel.value }));
    return sel;
  };

  const learning = h('input', { type: 'checkbox', checked: routing.learning !== false });
  learning.addEventListener('change', () => patch('model_routing', { learning: learning.checked }));

  
  const verEnabled = h('input', { type: 'checkbox', checked: verification.enabled !== false });
  verEnabled.addEventListener('change', () => patch('verification', { enabled: verEnabled.checked }));
  const LEVELS = ['none', 'basic', 'standard', 'strict'];
  const verLevel = h('select', { class: 'select' },
    ...LEVELS.map((l) => h('option', { value: l, selected: (verification.minimum_level || 'none') === l, text: l }))
  );
  verLevel.addEventListener('change', () => patch('verification', { minimum_level: verLevel.value }));

  
  const resEnabled = h('input', { type: 'checkbox', checked: research.enabled !== false });
  resEnabled.addEventListener('change', () => patch('research', { enabled: resEnabled.checked }));
  const resSubq = h('input', { class: 'input', type: 'number', min: '1', max: '6', value: String(research.max_subqueries ?? 4), style: 'width:90px' });
  resSubq.addEventListener('change', () => patch('research', { max_subqueries: Math.max(1, Math.min(6, Number(resSubq.value) || 4)) }));
  const resReads = h('input', { class: 'input', type: 'number', min: '0', max: '6', value: String(research.max_reads ?? 3), style: 'width:90px' });
  resReads.addEventListener('change', () => patch('research', { max_reads: Math.max(0, Math.min(6, Number(resReads.value) || 3)) }));

  
  const previewInput = h('input', { class: 'input', placeholder: 'Type a request to see how it would route…' });
  const previewOut = h('div', { class: 'decision-preview' });
  async function runPreview() {
    const q = previewInput.value.trim();
    if (!q) return;
    previewOut.innerHTML = '';
    previewOut.append(h('p', { class: 'faint', text: 'Classifying…' }));
    try {
      const res = await api.get(`/decision/preview?q=${encodeURIComponent(q)}`);
      if (destroyed) return;
      const d = res.decision || {};
      previewOut.innerHTML = '';
      previewOut.append(
        h('div', { class: 'decision-tags' },
          h('span', { class: `badge ${res.willRouteAgent ? 'accent' : ''}`, text: res.willRouteAgent ? 'Agent mode' : 'Direct chat' }),
          h('span', { class: 'badge', text: `type: ${d.taskType}` }),
          h('span', { class: 'badge', text: `complexity: ${d.complexity}` }),
          h('span', { class: 'badge', text: `tier: ${d.modelTier}` }),
          h('span', { class: 'badge', text: `verification: ${d.verification}` }),
          h('span', { class: 'badge', text: `risk: ${d.risk}` }),
          h('span', { class: 'badge', text: `confidence: ${Math.round((d.confidence || 0) * 100)}%` }),
          h('span', { class: 'badge', text: `via ${d.source}${d.decisionMs != null ? ` · ${d.decisionMs}ms` : ''}` })
        ),
        d.reason ? h('p', { class: 'faint', style: 'margin:8px 0 0', text: d.reason }) : null
      );
    } catch (err) {
      previewOut.innerHTML = '';
      previewOut.append(h('p', { class: 'faint', text: err.message }));
    }
  }
  previewInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPreview(); });

  
  const statsHost = h('div');
  async function loadStats() {
    try {
      const res = await api.get('/decision/stats');
      if (destroyed) return;
      statsHost.innerHTML = '';
      const rows = res.stats || [];
      if (!rows.length) {
        statsHost.append(h('p', { class: 'faint', text: 'No routing statistics yet. Aggregates appear as agent tasks run (last 14 days).' }));
        return;
      }
      statsHost.append(h('div', { class: 'card', style: 'padding:8px 16px' },
        h('table', { class: 'pricing-table' },
          h('thead', {}, h('tr', {}, ['Day', 'Task type', 'Turns', 'Escalations', 'Failures', 'Avg decision'].map((t) => h('th', { text: t })))),
          h('tbody', {}, rows.slice(0, 14).map((r) =>
            h('tr', {},
              h('td', { text: r.day }),
              h('td', { text: r.taskType }),
              h('td', { text: String(r.turns) }),
              h('td', { text: String(r.escalations) }),
              h('td', { text: String(r.failures) }),
              h('td', { text: `${r.avgDecisionMs}ms` })
            ))
          )
        )
      ));
    } catch (err) {
      statsHost.append(h('p', { class: 'faint', text: err.message }));
    }
  }
  const resetBtn = h('button', { class: 'btn sm ghost', html: `${icon('refresh')}<span>Reset statistics</span>`, onclick: async () => {
    try {
      await api.post('/decision/stats/reset');
      toast('Routing statistics reset', 'success', { timeout: 1200 });
      loadStats();
    } catch (err) { toast(err.message, 'error'); }
  } });

  host.append(
    h('div', { class: 'settings-panel' },
      section('Request routing (Jev decision layer)'),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Decision layer', 'Fast structured decisions that route each request — chat vs agent, model tier, verification — without invoking a large model to decide.', h('label', { class: 'checkbox' }, jevEnabled, h('span', { text: 'Enabled' }))),
        settingsRow('Confidence floor', 'Requests routing to chat with confidence below this keep the full agent capability set (fail-open).', floorInput),
        settingsRow('External Jev provider', 'Optional. Point Zeno at your own decision service or a small OpenAI-compatible classifier model; on any failure the built-in deterministic classifier takes over.', h('span', { class: 'badge', text: 'optional' })),
        settingsRow('Endpoint', 'The decision endpoint (JSON mode) or base URL ending in /v1 (OpenAI mode).', endpointInput),
        settingsRow('Provider mode & model', 'How the endpoint is called.', h('div', { style: 'display:flex;gap:8px' }, modeSelect, modelInput)),
        settingsRow('API key', 'Sent as a Bearer token; encrypted at rest and never read back.', keyInput)
      ),
      section('Model routing'),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Routing mode', 'Cost-aware model selection. Auxiliary calls (planning, history summaries, verification) are routed by tier; Full also routes the main agent loop for agent-mode tasks.', routingMode),
        settingsRow('Planning / summaries tier', 'Tier used for the Plan Mode planner and history compaction.', tierSelect('planning_tier', 'fast')),
        settingsRow('Wrap-up tier', 'Tier used when a long task is forced to conclude.', tierSelect('wrapup_tier', 'balanced')),
        settingsRow('Verification tier', 'Tier used by the output verifier.', tierSelect('verification_tier', 'balanced')),
        settingsRow('Learning execution policy', 'Anonymized per-task-type aggregates bias starting tiers upward when recent work kept needing escalation. Inspectable and resettable below; never self-modifying.', h('label', { class: 'checkbox' }, learning, h('span', { text: 'Enabled' })))
      ),
      section('Verification'),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Output verification', 'Complex, high-risk, and research answers are checked before they are finalized (deterministic checks, then a grader call at strict levels).', h('label', { class: 'checkbox' }, verEnabled, h('span', { text: 'Enabled' }))),
        settingsRow('Minimum level', 'Raise to force verification even on lighter agent turns.', verLevel)
      ),
      section('Research workflow'),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Automatic research', 'Research requests are decomposed into sub-queries, searched in parallel, and the top sources read before synthesis.', h('label', { class: 'checkbox' }, resEnabled, h('span', { text: 'Enabled' }))),
        settingsRow('Sub-queries per request', 'How many parallel searches a research turn decomposes into.', resSubq),
        settingsRow('Follow-up page reads', 'How many of the found sources are read in full.', resReads)
      ),
      section('Decision preview'),
      h('div', { class: 'card', style: 'padding:12px 20px' },
        h('div', { style: 'display:flex;gap:8px' },
          previewInput,
          h('button', { class: 'btn sm', html: `${icon('play')}<span>Classify</span>`, onclick: runPreview })
        ),
        previewOut
      ),
      section('Routing statistics'),
      h('div', { class: 'card', style: 'padding:12px 20px' },
        statsHost,
        h('div', { style: 'margin-top:10px' }, resetBtn)
      )
    )
  );
  loadStats();
  return { destroy() { destroyed = true; } };
}


export function costPanel(host) {
  let destroyed = false;
  const budgets = (store.state.settings.cost_governor) || {};

  async function patch(value) {
    try {
      await api.patch('/settings', { settings: { cost_governor: value } });
      toast('Saved', 'success', { timeout: 1200 });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const enabled = h('input', { type: 'checkbox', checked: budgets.enabled !== false });
  enabled.addEventListener('change', () => patch({ enabled: enabled.checked }));

  const numInput = (key, placeholder) => {
    const input = h('input', { class: 'input', type: 'number', min: '0', step: '0.01', placeholder, value: budgets[key] != null ? String(budgets[key]) : '', style: 'width:130px' });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      patch({ [key]: v === '' ? null : Math.max(0, Number(v) || 0) });
    });
    return input;
  };
  const action = h('select', { class: 'select' },
    h('option', { value: 'downgrade', selected: (budgets.action || 'downgrade') === 'downgrade', text: 'Downgrade to a cheaper tier' }),
    h('option', { value: 'block', selected: budgets.action === 'block', text: 'Block the call' })
  );
  action.addEventListener('change', () => patch({ action: action.value }));

  const summaryHost = h('div');
  async function load() {
    let data = null;
    try {
      data = await api.get('/cost/summary');
    } catch (err) {
      summaryHost.append(h('p', { class: 'faint', text: err.message }));
      return;
    }
    if (destroyed) return;
    summaryHost.innerHTML = '';
    const b = data.byDay || [];
    const maxCost = Math.max(...b.map((d) => d.cost), 0.000001);
    summaryHost.append(
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Estimated spend today', 'All model calls, estimated from per-model pricing.', h('span', { class: 'badge accent', text: `${money(data.today?.cost)} · ${data.today?.requests || 0} calls` })),
        settingsRow('Estimated spend this month', 'Calendar month to date.', h('span', { class: 'badge', text: `${money(data.month?.cost)} · ${data.month?.requests || 0} calls` }))
      ),
      b.length ? h('div', { class: 'card', style: 'padding:12px 20px;margin-top:12px' },
        h('h3', { class: 'panel-subhead', text: 'Last 14 days' }),
        ...b.map((d) => h('div', { class: 'spend-row', style: 'display:grid;grid-template-columns:92px 1fr auto;gap:10px;align-items:center;padding:2px 0' },
          h('span', { class: 'faint', text: d.day }),
          h('div', { style: `height:8px;border-radius:4px;background:linear-gradient(90deg,var(--accent),var(--accent-2));opacity:.75;width:${Math.max(2, Math.round((d.cost / maxCost) * 100))}%` }),
          h('span', { class: 'mono', text: `${money(d.cost)} · ${d.requests}` })
        ))
      ) : null,
      (data.byModel || []).length ? h('div', { class: 'card', style: 'padding:8px 16px;margin-top:12px' },
        h('h3', { class: 'panel-subhead', text: 'By model (30 days)' }),
        h('table', { class: 'pricing-table' },
          h('thead', {}, h('tr', {}, ['Model', 'Calls', 'Tokens in/out', 'Est. cost'].map((t) => h('th', { text: t })))),
          h('tbody', {}, data.byModel.map((m) =>
            h('tr', {},
              h('td', { class: 'mono', text: m.modelId }),
              h('td', { text: String(m.requests) }),
              h('td', { text: `${m.tokensIn.toLocaleString()} / ${m.tokensOut.toLocaleString()}` }),
              h('td', { text: money(m.cost) })
            ))
          )
        )
      ) : null,
      h('div', { class: 'card', style: 'padding:8px 16px;margin-top:12px' },
        h('h3', { class: 'panel-subhead', text: 'Pricing per model (estimates)' }),
        h('p', { class: 'faint', style: 'margin:0 0 8px', text: 'From your per-model pricing (Providers & models → edit a model → pricing), the built-in approximate table, or $0 for local providers. Set pricing on a model row for exact figures.' }),
        h('table', { class: 'pricing-table' },
          h('thead', {}, h('tr', {}, ['Model', 'Est. $/Mtok in', 'Est. $/Mtok out', 'Source'].map((t) => h('th', { text: t })))),
          h('tbody', {}, Object.entries(data.pricing || {}).map(([id, p]) =>
            p ? h('tr', {},
              h('td', { class: 'mono', text: id }),
              h('td', { text: `$${p.in}` }),
              h('td', { text: `$${p.out}` }),
              h('td', {}, h('span', { class: `badge ${p.source === 'user' ? 'accent' : p.source === 'builtin' ? '' : 'faint'}`, text: p.source }))
            ) : null
          ))
        )
      )
    );
  }

  host.append(
    h('div', { class: 'settings-panel' },
      section('Budgets'),
      h('div', { class: 'card', style: 'padding:6px 20px' },
        settingsRow('Cost governance', 'Track every model call, and enforce budgets when set. With no budgets configured, tracking is passive.', h('label', { class: 'checkbox' }, enabled, h('span', { text: 'Enabled' }))),
        settingsRow('Per-request budget (USD)', 'A single call estimated above this trips the budget action.', numInput('per_request_usd', 'no limit')),
        settingsRow('Per-day budget (USD)', 'Calendar day, all calls.', numInput('per_day_usd', 'no limit')),
        settingsRow('Per-month budget (USD)', 'Calendar month, all calls.', numInput('per_month_usd', 'no limit')),
        settingsRow('When a budget is exceeded', 'Downgrade retries the call on a cheaper tier; Block fails the request with an explanatory error.', action)
      ),
      section('Spend'),
      summaryHost
    )
  );
  load();
  return { destroy() { destroyed = true; } };
}
