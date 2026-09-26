import { h, toast, openDropdown, closeMenu, closeAllModals } from './ui.js';
import { icon, zenoMark } from './icons.js';
import { store, defaultModel } from './state.js';
import { api, setToken, setUnauthorizedHandler } from './api.js';
import { renderSidebarContent } from './components/sidebar.js';
import { openPalette } from './components/palette.js';
import { mountChatView } from './views/chat.js';
import { mountProvidersView } from './views/providers.js';
import { mountProjectsView, mountMemoryView, mountFilesView } from './views/misc.js';
import { mountSettingsView } from './views/settings.js';

const app = document.getElementById('app');
let currentView = null;
let workspace = null;
let bootId = 0;

function leaveWorkspace() {
  bootId++;
  workspace?.destroy();
  workspace = null;
  currentView?.destroy?.();
  currentView = null;
  closeMenu();
  closeAllModals();
}

function renderAuth(mode = 'login') {
  leaveWorkspace();
  document.title = 'Zeno AI — Sign in';
  app.className = '';
  app.replaceChildren();
  const isLogin = mode === 'login';
  const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const email = h('input', { id: 'auth-email', class: 'input', type: 'email', required: true, placeholder: 'you@example.com', autocomplete: 'email' });
  const name = h('input', { id: 'auth-name', class: 'input', required: !isLogin, placeholder: 'Your name', autocomplete: 'name' });
  const password = h('input', { id: 'auth-password', class: 'input', type: 'password', required: true, minlength: isLogin ? 1 : 8, placeholder: 'Password', autocomplete: isLogin ? 'current-password' : 'new-password' });
  const submit = h('button', { class: 'btn primary lg', type: 'submit', text: isLogin ? 'Sign in' : 'Create account', style: 'width:100%' });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    errorBox.hidden = true;
    submit.disabled = true;
    try {
      const body = { email: email.value.trim(), password: password.value };
      if (!isLogin) body.displayName = name.value.trim();
      const res = await api.post(isLogin ? '/auth/login' : '/auth/register', body);
      setToken(res.token);
      store.update({ user: res.user });
      await enterWorkspace();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  } }, errorBox,
  h('div', { class: 'field' }, h('label', { for: 'auth-email', text: 'Email' }), email),
  isLogin ? null : h('div', { class: 'field' }, h('label', { for: 'auth-name', text: 'Display name' }), name),
  h('div', { class: 'field' }, h('label', { for: 'auth-password', text: 'Password' }), password), submit);
  app.append(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'auth-brand' }, h('span', { html: zenoMark(48) }), h('h1', { text: 'Zeno' }), h('p', { text: 'Your models, your tools, one conversation.' })),
    form,
    h('div', { class: 'auth-switch' }, isLogin ? 'New here? ' : 'Already have an account? ',
      h('button', { text: isLogin ? 'Create an account' : 'Sign in', onclick: () => renderAuth(isLogin ? 'register' : 'login') }))
  )));
  email.focus();
}

function buildShell() {
  app.replaceChildren();
  app.className = 'app';
  let section = 'chat';
  let disposed = false;
  const sidebar = h('aside', { class: 'sidebar', id: 'workspace-sidebar', 'aria-label': 'Workspace' });
  const topbar = h('header', { class: 'topbar' });
  const viewRoot = h('div', { class: 'view-root' });
  const main = h('main', { class: 'main', id: 'main-content', tabindex: '-1' }, topbar, viewRoot);
  const mobile = () => window.innerWidth <= 860;
  function syncSidebar() {
    const expanded = mobile() ? app.classList.contains('sidebar-open') : !app.classList.contains('sidebar-collapsed');
    sidebar.inert = !expanded;
    main.inert = mobile() && expanded;
    app.querySelectorAll('[aria-controls="workspace-sidebar"]').forEach((b) => b.setAttribute('aria-expanded', String(expanded)));
  }
  function closeSidebar() {
    app.classList.remove('sidebar-open');
    syncSidebar();
  }
  function toggleSidebar() {
    app.classList.toggle(mobile() ? 'sidebar-open' : 'sidebar-collapsed');
    syncSidebar();
    if (sidebar.inert) topbar.querySelector('button')?.focus();
    else if (mobile()) sidebar.querySelector('button')?.focus();
  }
  const scrim = h('div', { class: 'sidebar-scrim', onclick: closeSidebar });
  const nav = h('nav', { class: 'sidebar-nav', 'aria-label': 'Main navigation' });
  const navWorkspace = h('nav', { class: 'sidebar-nav', 'aria-label': 'Workspace' });
  const body = h('div', { class: 'sidebar-body' });
  
  
  const labels = { chat: 'Chats', projects: 'Projects', connectors: 'Tools & connections', providers: 'Providers & models', files: 'Files', memory: 'Memory', settings: 'Settings' };
  const buttons = new Map();
  function navigate(next, id) {
    const hash = `#/${next}${id ? '/' + id : ''}`;
    if (location.hash === hash && next === 'chat' && !id) route();
    else location.hash = hash;
    closeSidebar();
  }
  const newChat = () => navigate('chat');

  const sidebarTitle = h('span', { text: 'Zeno' });
  
  
  const listBody = h('div', { class: 'sidebar-list' });
  sidebar.append(h('div', { class: 'sidebar-brand' },
    h('button', { class: 'brand-link', onclick: newChat, 'aria-label': 'Zeno home' }, h('span', { html: zenoMark(24) }), sidebarTitle),
    h('button', { class: 'icon-btn', title: 'Toggle sidebar (Ctrl+B)', 'aria-label': 'Toggle sidebar', 'aria-controls': 'workspace-sidebar', html: icon('panel'), onclick: toggleSidebar })),
    h('div', { class: 'sidebar-head' }, h('button', { class: 'btn primary new-chat', html: `${icon('plus')}<span>New chat</span>`, onclick: newChat }),
      h('button', { class: 'sidebar-link', onclick: openPalette }, h('span', { html: icon('search') }), h('span', { text: 'Search chats' }), h('span', { class: 'kbd', text: 'Ctrl K' }))),
    nav, h('div', { class: 'sidebar-group-label', text: 'Workspace' }), navWorkspace, body);
  body.append(listBody);
  
  
  for (const [key, glyph] of [['chat', 'chat'], ['projects', 'folder']]) {
    const button = h('button', { class: 'sidebar-link', onclick: () => navigate(key) }, h('span', { html: icon(glyph) }), h('span', { text: labels[key] }));
    buttons.set(key, button);
    nav.append(button);
  }
  for (const [key, glyph] of [['providers', 'key'], ['files', 'file'], ['memory', 'brain']]) {
    const button = h('button', { class: 'sidebar-link', onclick: () => navigate(key) }, h('span', { html: icon(glyph) }), h('span', { text: labels[key] }));
    buttons.set(key, button);
    navWorkspace.append(button);
  }

  const settingsButton = h('button', { class: 'sidebar-link', onclick: () => navigate('settings') },
    h('span', { html: icon('settings') }), h('span', { text: 'Settings' }));
  buttons.set('settings', settingsButton);

  const user = store.state.user;
  const account = h('button', { class: 'account-button', 'aria-label': 'Account menu', 'aria-haspopup': 'menu', onclick: (e) => {
    openDropdown(e.currentTarget, (menu, close) => menu.append(
      h('div', { class: 'menu-head', text: user?.email || '' }),
      h('button', { class: 'menu-item', html: `${icon('settings')}<span>Settings</span>`, onclick: () => { close(); navigate('settings'); } }),
      h('button', { class: 'menu-item', html: `${icon('sliders')}<span>Tools & capabilities</span>`, onclick: () => { close(); navigate('connectors'); } }),
      h('button', { class: 'menu-item', html: `${icon('key')}<span>Providers & models</span>`, onclick: () => { close(); navigate('providers'); } }),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item danger', html: `${icon('logout')}<span>Sign out</span>`, onclick: async () => {
        close();
        try { await api.post('/auth/logout'); } catch {}
        setToken(null);
        leaveWorkspace();
        store.update({ user: null, conversations: [], projects: [], providers: [], models: [], settings: {}, attachments: [], pendingApprovals: [], currentConversationId: null, currentModelId: null, permissionMode: 'ask', planMode: false });
        history.replaceState(null, '', '#/chat');
        renderAuth();
      } })
    ), { width: 252 });
  } }, h('span', { class: 'account-avatar', text: (user?.displayName || '?').slice(0, 1).toUpperCase() }),
  h('span', { class: 'account-copy' }, h('strong', { text: user?.displayName || 'My account' }), h('span', { text: 'Personal workspace' })), h('span', { html: icon('chevronDown') }));
  sidebar.append(h('div', { class: 'sidebar-foot' }, settingsButton, account));

  
  
  
  const skipLink = h('a', { class: 'skip-link', href: '#main-content', text: 'Skip to content', onclick: (e) => {
    e.preventDefault();
    const target = main;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  } });
  app.append(skipLink, sidebar, scrim, main);

  function refreshSidebar() {
    if (disposed) return;
    renderSidebarContent(section, listBody);
    for (const [key, button] of buttons) {
      button.classList.toggle('is-active', key === section);
      if (key === section) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }
  function refreshTopbar() {
    if (disposed) return;
    const conv = store.state.conversations.find((c) => c.id === store.state.currentConversationId);
    const title = section === 'chat' ? conv?.title || 'New chat' : labels[section];
    document.title = `${title} — Zeno`;
    topbar.replaceChildren(h('button', { class: 'icon-btn', 'aria-label': 'Toggle sidebar', title: 'Toggle sidebar (Ctrl+B)', 'aria-controls': 'workspace-sidebar', html: icon('panel'), onclick: toggleSidebar }),
      h('div', { class: 'topbar-title ellipsis', text: title }), h('div', { class: 'spacer' }));
    
    
    syncSidebar();
  }
  function route() {
    if (disposed) return;
    let [next, id] = location.hash.replace(/^#\/?/, '').split('/');
    if (['agent', 'agents', 'run', 'runs'].includes(next) || !labels[next]) {
      next = 'chat';
      id = null;
      history.replaceState(null, '', '#/chat');
    }
    
    
    let settingsTab = null;
    if (next === 'connectors') {
      next = 'settings';
      settingsTab = 'tools';
      history.replaceState(null, '', '#/settings/tools');
    }
    section = next;
    currentView?.destroy?.();
    currentView = null;
    closeMenu();
    closeAllModals();
    viewRoot.replaceChildren();
    closeSidebar();
    const mounts = {
      projects: mountProjectsView,
      providers: mountProvidersView,
      memory: mountMemoryView,
      files: mountFilesView,
      settings: (rootEl) => mountSettingsView(rootEl, { tab: settingsTab || id || null }),
    };
    currentView = section === 'chat' ? mountChatView(viewRoot, { conversationId: id || null }) : mounts[section](viewRoot);
    refreshSidebar();
    refreshTopbar();
  }
  function onKey(e) {
    if (e.key === 'Escape' && app.classList.contains('sidebar-open')) {
      closeSidebar();
      topbar.querySelector('button')?.focus();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const actions = { k: openPalette, n: newChat, b: toggleSidebar, '/': () => document.querySelector('.composer textarea')?.focus() };
    if (!e.shiftKey && actions[e.key.toLowerCase()]) {
      e.preventDefault();
      actions[e.key.toLowerCase()]();
    }
  }
  const unsubscribers = ['conversations', 'projects'].map((key) => store.subscribe(key, refreshSidebar));
  unsubscribers.push(store.subscribe('currentConversationId', () => { refreshSidebar(); refreshTopbar(); }));
  window.addEventListener('hashchange', route);
  
  
  window.addEventListener('popstate', route);
  window.addEventListener('resize', syncSidebar);
  window.addEventListener('zeno:new-chat', newChat);
  document.addEventListener('keydown', onKey);
  return { route, destroy() {
    disposed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener('hashchange', route);
    window.removeEventListener('popstate', route);
    window.removeEventListener('resize', syncSidebar);
    window.removeEventListener('zeno:new-chat', newChat);
    document.removeEventListener('keydown', onKey);
  } };
}

export async function loadProviders() {
  const res = await api.get('/providers');
  store.update({ providers: res.providers, models: res.models });
}
export async function loadProviderMeta() {
  const res = await api.get('/providers/meta');
  store.update({ providerKinds: res.kinds });
}
export async function loadConversations() {
  const res = await api.get('/conversations');
  store.update({ conversations: res.conversations });
}
export async function loadProjects() {
  const res = await api.get('/projects');
  store.update({ projects: res.projects });
}
export async function loadSettings() {
  const res = await api.get('/settings');
  store.update({ settings: res.settings || {} });
  document.documentElement.dataset.theme = store.state.settings.theme || 'dark';
  document.documentElement.dataset.density = store.state.settings.density || 'comfortable';
  const mode = ['ask', 'workspace', 'full'].includes(store.state.settings.permission_mode) ? store.state.settings.permission_mode : 'ask';
  store.update({ permissionMode: mode, planMode: store.state.settings.plan_mode === true });
}
export async function loadTools() {
  const res = await api.get('/runs/tools');
  store.update({ tools: res.tools, sandboxMode: res.sandboxMode });
}

async function enterWorkspace() {
  leaveWorkspace();
  const generation = bootId;
  await Promise.all([loadSettings(), loadProviders(), loadProviderMeta(), loadConversations(), loadProjects(), loadTools()]);
  if (generation !== bootId || !store.state.user) return;
  if (!store.state.currentModelId) store.update({ currentModelId: defaultModel()?.id || null });
  workspace = buildShell();
  workspace.route();
}

setUnauthorizedHandler(() => {
  setToken(null);
  store.update({ user: null });
  renderAuth();
});

(async function boot() {
  try {
    const me = await api.get('/auth/me');
    store.update({ user: me.user, authChecked: true });
    await enterWorkspace();
  } catch {
    store.update({ authChecked: true });
    renderAuth();
  }
})();
