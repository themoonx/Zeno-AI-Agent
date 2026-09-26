





import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:3211';
const OUT = path.join(process.cwd(), 'scripts', '_shots');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('No Chromium browser found');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const PORT = 9333 + Math.floor(Math.random() * 200);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-ui-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,960',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {  }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}


class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new CDP(ws);
}


let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  \u2714 ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  \u2718 ${name} ${extra}`);
  }
}


let stubProvider = null;
function ensureStubProvider() {
  if (stubProvider) return;
  stubProvider = spawn(process.execPath, [path.join(import.meta.dirname, 'stub-provider.js')], {
    env: { ...process.env, STUB_PORT: '9103' },
    stdio: 'ignore',
  });
}

async function main() {
  console.log('\u2500\u2500 Zeno UI verification (real Chrome) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  ensureStubProvider();
  await sleep(700);
  const browser = await connect(await debuggerUrl());
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => browser.send(m, p, sessionId);

  await S('Page.enable');
  await S('Runtime.enable');
  await S('Log.enable');
  await S('Network.enable');

  const consoleErrors = [];
  browser.ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description || 'exception');
    }
  });

  async function evaluate(expression) {
    const res = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'eval failed');
    return res.result.value;
  }

  async function goto(url) {
    await S('Page.navigate', { url });
    
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const ready = await evaluate(
        'document.readyState === "complete" && (!!document.querySelector(".auth-card") || !!document.querySelector(".sidebar") || !!document.querySelector(".boot-screen"))'
      ).catch(() => false);
      if (ready) break;
    }
    await sleep(1200);
  }

  async function shot(name) {
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  }

  
  await goto(BASE);
  let authVisible = await evaluate('!!document.querySelector(".auth-card")');
  if (!authVisible) {
    
    const state = await evaluate(`(() => ({
      ready: document.readyState,
      boot: !!document.querySelector(".boot-screen"),
      appHtml: (document.getElementById("app")?.innerHTML || "").slice(0, 200),
      errors: window.__errors || [],
    }))()`).catch((e) => ({ evalErr: String(e) }));
    console.log('    page state:', JSON.stringify(state));
    console.log('    console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
  }
  ok('auth screen renders', authVisible);

  const email = `ui_${Date.now()}@test.dev`;
  await evaluate(`(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    document.querySelector('.auth-switch button').click();
    set('#auth-email', ${JSON.stringify(email)});
    set('#auth-name', 'UI Tester');
    set('#auth-password', 'testpass123');
    return true;
  })()`);
  await sleep(300);
  await evaluate('document.querySelector(".auth-card form button[type=submit]").click()');
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evaluate('!!document.querySelector(".sidebar")').catch(() => false)) break;
  }
  const inWorkspace = await evaluate('!!document.querySelector(".sidebar") && !!document.querySelector(".main")');
  ok('workspace shell mounted after sign-up', inWorkspace);
  if (!inWorkspace) {
    console.log('    page text:', (await evaluate('document.body.innerText')).slice(0, 300));
  }

  
  const skip = await evaluate(`(() => {
    const a = document.querySelector('.skip-link');
    if (!a) return { missing: true };
    const cs = getComputedStyle(a);
    const app = document.querySelector('.app');
    const sb = document.querySelector('.sidebar');
    const appCS = getComputedStyle(app);
    return {
      text: a.textContent.trim(),
      href: a.getAttribute('href'),
      position: cs.position,
      inFlowAsFlexItem: cs.position === 'static',
      appDisplay: appCS.display,
      sidebarLeft: Math.round(sb.getBoundingClientRect().left),
      sidebarWidth: Math.round(sb.getBoundingClientRect().width),
      // Parked off-screen until focused.
      offscreen: a.getBoundingClientRect().bottom < 0 || a.getBoundingClientRect().top < -50,
    };
  })()`);
  ok('skip link exists with correct text', skip.text === 'Skip to content', JSON.stringify(skip));
  ok('skip link points at main content', skip.href === '#main-content');
  ok('skip link is out of flow (not a flex item)', skip.position === 'fixed', JSON.stringify(skip));
  ok('sidebar starts at left edge (skip link does not displace it)', skip.sidebarLeft === 0, `left=${skip.sidebarLeft}`);
  ok('sidebar has its full width', skip.sidebarWidth >= 260, `w=${skip.sidebarWidth}`);
  ok('skip link parked off-screen when unfocused', skip.offscreen === true, JSON.stringify(skip));

  
  await evaluate('document.body.focus(); document.querySelector(".skip-link").focus();');
  await sleep(250);
  const focused = await evaluate(`(() => {
    const a = document.querySelector('.skip-link');
    const cs = getComputedStyle(a);
    return {
      isFocused: document.activeElement === a,
      transform: cs.transform,
      top: Math.round(a.getBoundingClientRect().top),
      visible: a.getBoundingClientRect().top >= 0,
    };
  })()`);
  ok('skip link is revealed on focus', focused.visible && focused.isFocused, JSON.stringify(focused));
  await shot('01-skip-link-focused');

  
  await evaluate('document.querySelector(".skip-link").click()');
  await sleep(350);
  const afterSkip = await evaluate(`(() => {
    const main = document.getElementById('main-content');
    return {
      focused: document.activeElement === main,
      mainExists: !!main,
      tabindex: main?.getAttribute('tabindex'),
    };
  })()`);
  ok('clicking skip link moves focus into #main-content', afterSkip.focused, JSON.stringify(afterSkip));

  
  const sidebar = await evaluate(`(() => {
    const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
    const rows = links.map((l) => {
      const iconBox = l.querySelector('span');
      const label = l.querySelector('span:last-child');
      const ir = iconBox.getBoundingClientRect();
      const lr = label.getBoundingClientRect();
      const lr2 = l.getBoundingClientRect();
      const svg = iconBox.querySelector('svg');
      const sr = svg?.getBoundingClientRect();
      return {
        text: (label.textContent || '').trim(),
        rowH: Math.round(lr2.height),
        iconW: Math.round(ir.width),
        iconH: Math.round(ir.height),
        iconLeft: Math.round(ir.left),
        iconCenterY: sr ? Math.round(sr.top + sr.height / 2) : null,
        rowCenterY: Math.round(lr2.top + lr2.height / 2),
        labelLeft: Math.round(lr.left),
        svgW: sr ? Math.round(sr.width) : null,
      };
    });
    const hasBrand = !!document.querySelector('.sidebar-brand .brand-link');
    const hasAccount = !!document.querySelector('.sidebar-foot .account-button');
    return { count: rows.length, rows, hasBrand, hasAccount };
  })()`);
  ok('sidebar renders navigation links', sidebar.count >= 5, `count=${sidebar.count}`);
  ok('sidebar brand row present', sidebar.hasBrand);
  ok('sidebar account row present', sidebar.hasAccount);

  const iconLefts = new Set(sidebar.rows.map((r) => r.iconLeft));
  ok('all nav icons share one left edge', iconLefts.size === 1, `lefts=${[...iconLefts].join(',')}`);
  const labelLefts = new Set(sidebar.rows.map((r) => r.labelLeft));
  ok('all nav labels share one left edge', labelLefts.size === 1, `lefts=${[...labelLefts].join(',')}`);
  const rowHeights = new Set(sidebar.rows.map((r) => r.rowH));
  ok('all nav rows share one height', rowHeights.size === 1, `heights=${[...rowHeights].join(',')}`);
  const iconSizes = new Set(sidebar.rows.map((r) => `${r.iconW}x${r.iconH}`));
  ok('all nav icon boxes are uniform', iconSizes.size === 1, `sizes=${[...iconSizes].join(',')}`);
  const svgWidths = new Set(sidebar.rows.map((r) => r.svgW));
  ok('all nav icon glyphs render at one size', svgWidths.size === 1 && !svgWidths.has(0), `w=${[...svgWidths].join(',')}`);
  const centered = sidebar.rows.every((r) => r.iconCenterY != null && Math.abs(r.iconCenterY - r.rowCenterY) <= 2);
  ok('icons are vertically centered in their rows', centered,
    sidebar.rows.map((r) => `${r.text}:${r.iconCenterY}/${r.rowCenterY}`).join(' '));
  await shot('02-sidebar');

  
  await evaluate(`document.querySelector('.topbar [aria-controls="workspace-sidebar"]').click()`);
  await sleep(500);
  const collapsed = await evaluate(`(() => {
    const sb = document.querySelector('.sidebar');
    return { width: Math.round(sb.getBoundingClientRect().width), collapsed: document.querySelector('.app').classList.contains('sidebar-collapsed') };
  })()`);
  ok('sidebar collapses', collapsed.collapsed && collapsed.width < 10, JSON.stringify(collapsed));
  await evaluate(`document.querySelector('.topbar [aria-controls="workspace-sidebar"]').click()`);
  await sleep(500);
  const expanded = await evaluate('Math.round(document.querySelector(".sidebar").getBoundingClientRect().width)');
  ok('sidebar expands back to full width', expanded >= 260, `w=${expanded}`);

  
  const mainPageTools = await evaluate(`(() => {
    const topbar = document.querySelector('.topbar');
    const composer = document.querySelector('.composer-bar');
    return {
      topbarTools: !!topbar?.querySelector('button.btn.ghost.sm'),
      composerTools: !!composer?.querySelector('.composer-tools'),
      bodyHasConnectorView: !!document.querySelector('.view-inner > .view-head h1')?.textContent?.includes('Tools & connections'),
    };
  })()`);
  ok('no Tools button in the top bar', mainPageTools.topbarTools === false);
  ok('no Tools button in the composer', mainPageTools.composerTools === false);

  
  await evaluate(`location.hash = '#/settings'`);
  await sleep(900);
  const settingsTabs = await evaluate(`[...document.querySelectorAll('.settings-tab')].map((t) => t.textContent.trim())`);
  ok('Settings exposes a tabbed surface', settingsTabs.length >= 5, JSON.stringify(settingsTabs));
  ok('Settings includes Tools & capabilities tab', settingsTabs.some((t) => /Tools & capabilities/i.test(t)), JSON.stringify(settingsTabs));
  ok('Settings includes Connections tab', settingsTabs.some((t) => /Connections/i.test(t)), JSON.stringify(settingsTabs));
  ok('Settings includes Providers tab', settingsTabs.some((t) => /Providers/i.test(t)), JSON.stringify(settingsTabs));
  ok('control center: Permissions / Environments / Workspaces / Security tabs present',
    ['Permissions', 'Environments', 'Workspaces', 'Security'].every((t) => settingsTabs.some((x) => x.includes(t))), JSON.stringify(settingsTabs));
  ok('Settings includes Intelligence tab (Jev routing / verification / research)',
    settingsTabs.some((t) => /Intelligence/i.test(t)), JSON.stringify(settingsTabs));
  ok('Settings includes Cost & Usage tab', settingsTabs.some((t) => /Cost & Usage/i.test(t)), JSON.stringify(settingsTabs));
  await shot('03-settings-general');

  
  await evaluate(`location.hash = '#/settings/intelligence'`);
  await sleep(1100);
  const intelTab = await evaluate(`(() => ({
    heading: [...document.querySelectorAll('.panel-subhead')].map((x) => x.textContent.trim()),
    rows: document.querySelectorAll('.settings-row').length,
    checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
    previewInput: !!document.querySelector('.decision-preview') || !!document.querySelector('input[placeholder*="route"]'),
  }))()`);
  ok('intelligence tab exposes the decision layer, routing, verification, and research sections',
    ['Request routing (Jev decision layer)', 'Model routing', 'Verification', 'Research workflow'].every((h) => intelTab.heading.includes(h)) && intelTab.rows >= 8, JSON.stringify(intelTab));
  await shot('03c-settings-intelligence');

  
  await evaluate(`location.hash = '#/settings/cost'`);
  await sleep(1100);
  const costTab = await evaluate(`(() => ({
    heading: [...document.querySelectorAll('.panel-subhead')].map((x) => x.textContent.trim()),
    rows: document.querySelectorAll('.settings-row').length,
  }))()`);
  ok('cost tab shows budgets and spend sections', costTab.heading.includes('Budgets') && costTab.heading.includes('Spend') && costTab.rows >= 4, JSON.stringify(costTab));
  await shot('03d-settings-cost');

  
  await evaluate(`location.hash = '#/settings/permissions'`);
  await sleep(1100);
  const permTab = await evaluate(`(() => ({
    modes: [...document.querySelectorAll('.perm-mode strong')].map((m) => m.textContent.trim()),
    activeMode: document.querySelector('.perm-mode.is-active strong')?.textContent.trim(),
    preview: document.querySelector('.perm-preview')?.textContent.trim().slice(0, 60),
  }))()`);
  ok('permissions tab shows the four permission presets with active state',
    JSON.stringify(permTab.modes) === JSON.stringify(['Ask Before Change', 'Edit Automatically', 'Workspace Edit', 'Full Access']) && permTab.activeMode === 'Ask Before Change', JSON.stringify(permTab));
  ok('permissions tab runs a live decision preview', /ALLOW|ASK|DENY/.test(permTab.preview || ''), JSON.stringify(permTab));
  await shot('03b-settings-permissions');

  
  await evaluate(`location.hash = '#/settings/environments'`);
  await sleep(900);
  const envTab = await evaluate(`(() => ({
    heading: [...document.querySelectorAll('.panel-subhead')].map((x) => x.textContent.trim()),
    rows: document.querySelectorAll('.settings-row').length,
  }))()`);
  ok('environments tab shows execution environments + local agents', envTab.heading.includes('Execution environments') && envTab.heading.includes('Local agents') && envTab.rows >= 3, JSON.stringify(envTab));

  
  await evaluate(`location.hash = '#/settings/security'`);
  await sleep(900);
  const secTab = await evaluate(`(() => ({
    heading: [...document.querySelectorAll('.panel-subhead')].map((x) => x.textContent.trim()),
    sessions: document.querySelectorAll('.audit-row').length,
  }))()`);
  ok('security tab shows sessions and audit log', secTab.heading.includes('Active sessions') && secTab.heading.includes('Audit log') && secTab.sessions >= 1, JSON.stringify(secTab));


  
  await evaluate(`location.hash = '#/settings/tools'`);
  await sleep(1200);
  const harness = await evaluate(`(() => {
    const stats = [...document.querySelectorAll('.stat-card')].map((c) => ({
      label: c.querySelector('.stat-label')?.textContent.trim(),
      value: c.querySelector('.stat-value')?.textContent.trim(),
    }));
    const tabs = [...document.querySelectorAll('.tabs .tab')].map((t) => t.textContent.trim());
    const rows = [...document.querySelectorAll('.cap-row')].length;
    const groups = [...document.querySelectorAll('.cap-group-head h3')].map((g) => g.textContent.trim());
    return { stats, tabs, rows, groups };
  })()`);
  ok('harness shows capability stats', harness.stats.length === 4, JSON.stringify(harness.stats));
  ok('harness tools are grouped by origin', harness.groups.length >= 3, JSON.stringify(harness.groups));
  ok('harness lists tool rows', harness.rows >= 8, `rows=${harness.rows}`);
  ok('harness exposes tools/skills/plugins/orchestration tabs',
    ['Tools', 'Skills', 'Plugins', 'Orchestration'].every((t) => harness.tabs.includes(t)), JSON.stringify(harness.tabs));
  await shot('04-harness-tools');

  
  await evaluate(`[...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.trim() === 'Skills').click()`);
  await sleep(800);
  const skills = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.cap-row')];
    return {
      count: rows.length,
      names: rows.map((r) => r.querySelector('.cap-title strong')?.textContent.trim()),
      hasNew: !!document.querySelector('.panel-toolbar .btn.primary'),
    };
  })()`);
  ok('skills tab lists built-in skills', skills.count >= 4, JSON.stringify(skills.names));
  ok('skills tab offers creating a skill', skills.hasNew);
  await shot('05-harness-skills');

  
  await evaluate(`[...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.trim() === 'Orchestration').click()`);
  await sleep(700);
  const orch = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.settings-row .sr-title')].map((r) => r.textContent.trim());
    const hasProbe = !!document.querySelector('.probe-result') || !!document.querySelector('input[placeholder*="preview"]');
    return { rows, hasProbe };
  })()`);
  ok('orchestration tab exposes the auto-orchestration toggles',
    orch.rows.some((r) => /Automatic orchestration/i.test(r)) && orch.rows.some((r) => /skill/i.test(r)), JSON.stringify(orch.rows));
  ok('orchestration tab offers a live preview', orch.hasProbe);

  
  await evaluate(`(() => {
    const el = document.querySelector('input[placeholder*="preview"]');
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, 'Please do deep research on WebGPU and cite sources');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(1600);
  const probeText = await evaluate(`document.querySelector('.probe-result')?.innerText || ''`);
  ok('orchestration preview matches a research request to the Deep Research skill',
    /Deep Research/i.test(probeText), JSON.stringify(probeText.slice(0, 160)));
  await shot('06-harness-orchestration');

  
  await evaluate(`location.hash = '#/settings/connections'`);
  await sleep(1100);
  const conn = await evaluate(`(() => {
    const h2 = document.querySelector('.settings-panel-head h2')?.textContent.trim();
    const add = !!document.querySelector('.settings-panel-head .btn.primary');
    const empty = !!document.querySelector('.empty h3');
    return { h2, add, empty, hash: location.hash, settingsActive: !!document.querySelector('.settings-tab.is-active') };
  })()`);
  ok('connections render inside Settings', /Connections/i.test(conn.h2 || ''), JSON.stringify(conn));
  ok('connections panel offers adding an MCP/HTTP connection', conn.add);
  ok('settings stays the active nav section', conn.settingsActive);

  
  await goto(`${BASE}/#/connectors`);
  await sleep(1200);
  const legacy = await evaluate(`(() => ({
    hash: location.hash,
    hasSettingsTabs: !!document.querySelector('.settings-tab'),
    toolsActive: [...document.querySelectorAll('.settings-tab.is-active')].map((t) => t.textContent.trim()),
  }))()`);
  ok('legacy #/connectors redirects into Settings', legacy.hash.startsWith('#/settings'), JSON.stringify(legacy));
  await shot('07-settings-connections');

  
  await goto(`${BASE}/#/settings/providers`);
  await sleep(900);
  const providers = await evaluate(`(() => ({
    heading: document.querySelector('.settings-panel-head h2')?.textContent.trim() || document.querySelector('.view-head h1')?.textContent.trim(),
    hasAdd: !!document.querySelector('.settings-panel-head .btn.primary'),
    hasCustomHint: document.body.innerText.includes('OpenAI-compatible'),
  }))()`);
  ok('providers & models available in Settings', /Providers/i.test(providers.heading || ''), JSON.stringify(providers));
  ok('custom/OpenAI-compatible provider path is offered', providers.hasCustomHint);
  await shot('08-settings-providers');

  await goto(`${BASE}/#/chat`);
  await sleep(1000);
  const chat = await evaluate(`(() => ({
    hero: !!document.querySelector('.chat-hero'),
    composer: !!document.querySelector('.composer textarea'),
    suggestions: document.querySelectorAll('.suggestion').length,
  }))()`);
  ok('chat view still renders with composer', chat.composer && chat.hero, JSON.stringify(chat));
  ok('chat hero suggestions present', chat.suggestions >= 3, `n=${chat.suggestions}`);
  await shot('09-chat');

  
  await evaluate(`document.documentElement.dataset.theme = 'light'`);
  await sleep(500);
  await shot('10-chat-light');
  await evaluate(`document.documentElement.dataset.theme = 'dark'`);

  
  
  const agent = await evaluate(`(() => ({
    permChip: document.querySelector('.composer-bar .perm-chip .label')?.textContent.trim(),
    planChip: !!document.querySelector('.composer-bar .plan-chip'),
  }))()`);
  ok('composer shows the permission-mode chip (default Ask Before Change)', agent.permChip === 'Ask Before Change', JSON.stringify(agent));
  ok('composer shows the Plan Mode toggle', agent.planChip);

  
  await evaluate(`document.querySelector('.composer-bar .perm-chip').click()`);
  await sleep(400);
  const permMenu = await evaluate(`(() => ({
    options: [...document.querySelectorAll('.menu .perm-option .perm-copy strong')].map((o) => o.textContent.trim()),
    hints: [...document.querySelectorAll('.menu .perm-option .perm-hint')].length,
  }))()`);
  ok('permission menu lists exactly the four permission presets',
    JSON.stringify(permMenu.options) === JSON.stringify(['Ask Before Change', 'Edit Automatically', 'Workspace Edit', 'Full Access']) && permMenu.hints === 4, JSON.stringify(permMenu));
  await evaluate(`[...document.querySelectorAll('.menu .perm-option')].find((o) => o.textContent.includes('Workspace Edit'))?.click()`);
  await sleep(600);
  const permNow = await evaluate(`document.querySelector('.composer-bar .perm-chip .label')?.textContent.trim()`);
  ok('switching mode updates the chip', permNow === 'Workspace Edit', permNow);

  
  await goto(`${BASE}/#/chat`);
  await sleep(900);
  const permPersisted = await evaluate(`document.querySelector('.composer-bar .perm-chip .label')?.textContent.trim()`);
  ok('permission mode persists after reload', permPersisted === 'Workspace Edit', permPersisted);

  
  await evaluate(`document.querySelector('.composer-bar .perm-chip').click()`);
  await sleep(300);
  await evaluate(`[...document.querySelectorAll('.menu .perm-option')].find((o) => o.textContent.includes('Ask Before Change'))?.click()`);
  await sleep(400);

  
  
  await evaluate(`(async () => {
    const j = (r) => r.json();
    const prov = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'openai-compatible', name: 'UI Stub', baseUrl: 'http://127.0.0.1:9103/v1', apiKey: 'sk-stub-ui', test: true }) }).then(j);
    const model = await fetch('/api/providers/' + prov.provider.id + '/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: 'stub-chat-1', displayName: 'Stub Chat', capabilities: ['chat', 'tools'] }) }).then(j);
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { default_model: { modelId: model.model.id } } }) });
    return true;
  })()`);
  await sleep(400);
  
  
  await evaluate(`location.reload()`);
  await sleep(1500);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evaluate(`!!document.querySelector('.composer textarea')`).catch(() => false)) break;
  }
  const modelReady = await evaluate(`document.querySelector('.model-chip .label')?.textContent.trim()`);
  ok('model chip resolves the registered default model', modelReady === 'Stub Chat', modelReady);

  
  await evaluate(`document.querySelector('.composer-bar .plan-chip').click()`);
  await sleep(400);
  const planOn = await evaluate(`document.querySelector('.composer-bar .plan-chip').classList.contains('on')`);
  ok('Plan Mode toggle switches on', planOn);

  
  await evaluate(`(() => {
    const ta = document.querySelector('.composer textarea');
    const proto = Object.getPrototypeOf(ta);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, 'USE_FILE_TOOL: write preview.txt');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.send-btn').click();
    return true;
  })()`);

  
  let sawPlan = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    sawPlan = await evaluate(`(() => ({
      plan: !!document.querySelector('.plan-card'),
      steps: document.querySelectorAll('.plan-card .plan-steps li').length,
      thinking: !!document.querySelector('.thinking'),
      pending: !!document.querySelector('.plan-card.is-pending'),
    }))()`).catch(() => null);
    if (sawPlan?.plan && sawPlan?.pending) break;
  }
  ok('Plan Mode renders an animated plan card with steps', sawPlan?.plan && sawPlan.steps > 0, JSON.stringify(sawPlan));
  ok('plan card waits in the pending state under Ask Before Change', sawPlan?.pending);
  if (sawPlan?.thinking) await shot('12-thinking-and-plan');
  ok('thinking indicator visible while the turn works', sawPlan?.thinking === true, JSON.stringify(sawPlan));

  
  await evaluate(`document.querySelector('.plan-card .plan-actions .btn.primary')?.click()`);
  let sawTool = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    sawTool = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.activity')];
      const done = cards.find((c) => c.querySelector('.activity-view'));
      return {
        cards: cards.length,
        viewBtn: !!done,
        sub: done?.querySelector('.activity-sub')?.textContent.trim(),
        title: done?.querySelector('.activity-file')?.textContent.trim(),
      };
    })()`).catch(() => null);
    if (sawTool?.viewBtn) break;
  }
  ok('tool activity card renders with a View button', sawTool?.viewBtn, JSON.stringify(sawTool));
  ok('file card shows the written file name', /preview\.txt/.test(sawTool?.title || ''), JSON.stringify(sawTool));
  await shot('13-agent-activity');

  
  await evaluate(`document.querySelector('.activity-view')?.click()`);
  await sleep(600);
  const preview = await evaluate(`(() => ({
    open: !!document.querySelector('.file-preview'),
    name: document.querySelector('.fp-name')?.textContent.trim(),
    badge: document.querySelector('.fp-badge')?.textContent.trim(),
    lines: document.querySelectorAll('.fp-gutter span').length,
    hasCode: (document.querySelector('.fp-pre')?.textContent || '').length > 0,
  }))()`);
  ok('file preview panel opens', preview.open && preview.hasCode, JSON.stringify(preview));
  ok('preview shows the file with a written badge and line numbers', /preview\.txt/.test(preview.name || '') && /written|created/i.test(preview.badge || '') && preview.lines > 0, JSON.stringify(preview));
  await shot('14-file-preview');
  await evaluate(`document.querySelector('.file-preview .icon-btn[title^="Close"]')?.click()`);
  await sleep(400);
  ok('preview closes', !(await evaluate(`!!document.querySelector('.file-preview')`)));

  
  await evaluate(`document.querySelector('.composer-bar .plan-chip').click()`);
  await sleep(300);

  
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto(`${BASE}/#/chat`);
  await sleep(800);
  const mobileClosed = await evaluate(`(() => {
    const sb = document.querySelector('.sidebar');
    const r = sb.getBoundingClientRect();
    return { offscreen: r.right <= 0, open: document.querySelector('.app').classList.contains('sidebar-open') };
  })()`);
  ok('mobile: sidebar starts hidden', mobileClosed.offscreen && !mobileClosed.open, JSON.stringify(mobileClosed));

  await evaluate(`document.querySelector('.topbar [aria-controls="workspace-sidebar"]').click()`);
  await sleep(600);
  const mobileOpen = await evaluate(`(() => {
    const sb = document.querySelector('.sidebar');
    const links = [...document.querySelectorAll('.sidebar-nav .sidebar-link')];
    const iconLefts = new Set(links.map((l) => Math.round(l.querySelector('span').getBoundingClientRect().left)));
    const labelLefts = new Set(links.map((l) => Math.round(l.querySelector('span:last-child').getBoundingClientRect().left)));
    const heights = new Set(links.map((l) => Math.round(l.getBoundingClientRect().height)));
    return {
      visibleLeft: Math.round(sb.getBoundingClientRect().left) === 0,
      visibleWidth: Math.round(sb.getBoundingClientRect().width),
      iconLefts: [...iconLefts],
      labelLefts: [...labelLefts],
      heights: [...heights],
      scrimVisible: !!document.querySelector('.app.sidebar-open .sidebar-scrim'),
    };
  })()`);
  ok('mobile: drawer opens flush with the left edge', mobileOpen.visibleLeft, JSON.stringify(mobileOpen));
  ok('mobile: drawer keeps full width', mobileOpen.visibleWidth >= 260, `w=${mobileOpen.visibleWidth}`);
  ok('mobile: icons stay on one shared edge', mobileOpen.iconLefts.length === 1, JSON.stringify(mobileOpen.iconLefts));
  ok('mobile: labels stay on one shared edge', mobileOpen.labelLefts.length === 1, JSON.stringify(mobileOpen.labelLefts));
  ok('mobile: rows stay uniform height', mobileOpen.heights.length === 1, JSON.stringify(mobileOpen.heights));
  ok('mobile: scrim appears behind the drawer', mobileOpen.scrimVisible);
  await shot('11-mobile-sidebar-open');

  
  await evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  `);
  await sleep(500);
  const mobileEscaped = await evaluate(`!document.querySelector('.app').classList.contains('sidebar-open')`);
  ok('mobile: Escape closes the drawer', mobileEscaped);
  await S('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  
  
  const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR_|404|\(401\)|Failed to load resource/i.test(e));
  ok('no console errors during the whole run', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 4)));

  console.log('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(` ${passed} passed, ${failed} failed`);
  if (failed) console.log(` failures: ${failures.join(' | ')}`);
  console.log(` screenshots: ${OUT}`);
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    chrome.kill();
    stubProvider?.kill();
    process.exit(code);
  })
  .catch((err) => {
    console.error('verify crashed:', err);
    chrome.kill();
    stubProvider?.kill();
    process.exit(1);
  });