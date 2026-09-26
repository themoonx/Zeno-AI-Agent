
import { h } from '../ui.js';
import { icon } from '../icons.js';
import { store } from '../state.js';
import { api } from '../api.js';

let paletteEl = null;

export function openPalette() {
  if (paletteEl) return;
  const root = document.getElementById('palette-root');

  const input = h('input', { placeholder: 'Type a command or search…', 'aria-label': 'Command palette' });
  const listEl = h('div', { class: 'palette-list' });
  let selectedIndex = 0;
  let filtered = [];

  const commands = buildCommands();

  function buildItems() {
    const q = input.value.trim().toLowerCase();
    filtered = commands.filter((c) => !q || c.label.toLowerCase().includes(q) || (c.keywords || '').includes(q));
    if (q) {
      
      const convs = store.state.conversations.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 5);
      filtered = [
        ...convs.map((c) => ({
          label: c.title,
          hint: 'conversation',
          icon: 'chat',
          run: () => (location.hash = `#/chat/${c.id}`),
        })),
        ...filtered,
      ];
    }
    selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
    listEl.innerHTML = '';
    if (!filtered.length) {
      listEl.append(h('div', { class: 'palette-empty', text: 'Nothing matches.' }));
      return;
    }
    filtered.forEach((c, i) => {
      listEl.append(
        h(
          'button',
          {
            class: `palette-item${i === selectedIndex ? ' selected' : ''}`,
            onclick: () => {
              c.run();
              close();
            },
          },
          h('span', { html: icon(c.icon || 'circle') }),
          h('span', { class: 'pi-label', text: c.label }),
          c.hint ? h('span', { class: 'pi-hint', text: c.hint }) : null
        )
      );
    });
    listEl.querySelector('.palette-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function moveSelection(delta) {
    if (!filtered.length) return;
    selectedIndex = (selectedIndex + delta + filtered.length) % filtered.length;
    buildItems();
  }

  const scrim = h(
    'div',
    { class: 'palette-scrim' },
    h(
      'div',
      { class: 'palette', role: 'dialog', 'aria-label': 'Command palette' },
      h('div', { class: 'palette-input' }, h('span', { html: icon('search') }), input),
      listEl,
      h(
        'div',
        { class: 'palette-foot' },
        h('span', {}, h('span', { class: 'kbd', text: '↑↓' }), ' navigate'),
        h('span', {}, h('span', { class: 'kbd', text: 'Enter' }), ' run'),
        h('span', {}, h('span', { class: 'kbd', text: 'Esc' }), ' close')
      )
    )
  );

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[selectedIndex]?.run();
      close();
    }
  }

  function close() {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    paletteEl = null;
  }

  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  input.addEventListener('input', () => {
    selectedIndex = 0;
    buildItems();
  });
  document.addEventListener('keydown', onKey);

  root.append(scrim);
  paletteEl = scrim;
  buildItems();
  input.focus();
}

function buildCommands() {
  const cmds = [
    { label: 'New chat', icon: 'plus', hint: 'Ctrl+N', run: () => window.dispatchEvent(new CustomEvent('zeno:new-chat')) },
    { label: 'Go to Chats', icon: 'chat', run: () => (location.hash = '#/chat') },
    { label: 'Go to Projects', icon: 'folder', run: () => (location.hash = '#/projects') },
    { label: 'Go to Providers & Models', icon: 'key', run: () => (location.hash = '#/settings/providers') },
    { label: 'Go to Memory', icon: 'brain', run: () => (location.hash = '#/memory') },
    { label: 'Go to Files', icon: 'file', run: () => (location.hash = '#/files') },
    { label: 'Settings', icon: 'settings', run: () => (location.hash = '#/settings') },
    { label: 'Tools & capabilities', icon: 'zap', hint: 'harness', run: () => (location.hash = '#/settings/tools') },
    { label: 'Connections (MCP & plugins)', icon: 'plug', run: () => (location.hash = '#/settings/connections') },
    { label: 'Appearance', icon: 'eye', run: () => (location.hash = '#/settings/appearance') },
  ];
  if (store.state.streaming) {
    cmds.unshift({
      label: 'Stop generating',
      icon: 'stop',
      run: () => window.dispatchEvent(new CustomEvent('zeno:stop-stream')),
    });
  }
  return cmds;
}
