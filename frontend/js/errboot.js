

window.__errs = window.__errs || [];
window.addEventListener('error', (e) => {
  window.__errs.push(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason?.stack || String(e.reason);
  window.__errs.push(`unhandled rejection: ${reason}`);
});
