


export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') el.disabled = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}


import { icon } from './icons.js';

export function toast(message, type = 'info', { timeout = 4200 } = {}) {
  const root = document.getElementById('toasts');
  const iconName = type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : 'info';
  const el = h('div', { class: `toast ${type}`, role: 'status' }, h('span', { html: icon(iconName) }), h('span', { text: message }));
  root.append(el);
  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (timeout) setTimeout(remove, timeout);
  el.addEventListener('click', remove);
  return remove;
}


const modalStack = [];

export function openModal({ title, subtitle, body, footer, wide = false, onClose = null }) {
  const root = document.getElementById('modals');
  const scrim = h('div', { class: 'scrim' });
  const modal = h(
    'div',
    { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'modal-head' },
      h('div', {}, h('h2', { text: title }), subtitle ? h('div', { class: 'modal-sub', text: subtitle }) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', html: icon('x'), onclick: () => close() })
    ),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null
  );
  scrim.append(modal);
  root.append(scrim);

  const close = () => {
    scrim.remove();
    const i = modalStack.indexOf(close);
    if (i !== -1) modalStack.splice(i, 1);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  modalStack.push(close);
  const firstInput = modal.querySelector('input, textarea, select, button.btn');
  firstInput?.focus();
  return { close, modal };
}

export function closeAllModals() {
  while (modalStack.length) modalStack[modalStack.length - 1]();
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const { close } = openModal({
      title,
      body: h('p', { class: 'muted', text: message }),
      onClose: () => {
        if (!decided) resolve(false);
      },
      footer: [
        h('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { decided = false; close(); } }),
        h(
          'button',
          {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            text: confirmLabel,
            onclick: () => {
              decided = true;
              close();
              resolve(true);
            },
          }
        ),
      ],
    });
  });
}


let openMenuCleanup = null;

export function closeMenu() {
  openMenuCleanup?.();
  openMenuCleanup = null;
}


export function openDropdown(anchor, build, { align = 'start', width } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  if (width) menu.style.width = typeof width === 'number' ? width + 'px' : width;
  build(menu, () => closeMenu());

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = align === 'end' ? rect.right - mw : rect.left;
  let y = rect.bottom + 6;
  x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  if (y + mh > window.innerHeight - 8) {
    y = Math.max(8, rect.top - mh - 6);
  }
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const onDown = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
  });
  openMenuCleanup = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('keydown', onKey);
  };
  return openMenuCleanup;
}


export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success', { timeout: 1600 });
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard', 'success', { timeout: 1600 });
  }
}


export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
