


import path from 'node:path';
import { config } from '../core/config.js';

export const PREVIEW_CHARS = 16_000;

export function clip(text) {
  const s = String(text ?? '');
  return s.length > PREVIEW_CHARS ? { content: s.slice(0, PREVIEW_CHARS), truncated: true } : { content: s, truncated: false };
}

export function localBridgeEnabled() {
  return !!config.localBridge?.enabled && (config.localBridge.roots?.length || 0) > 0;
}

export function localRoots() {
  return (config.localBridge?.roots || []).map((r) => path.resolve(r));
}

function norm(p) {
  const resolved = path.resolve(String(p || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function resolveWithinRoots(rawPath) {
  const roots = localRoots();
  const wanted = path.resolve(String(rawPath || ''));
  const wn = norm(wanted);
  const hit = roots.find((r) => {
    const rn = norm(r);
    return wn === rn || wn.startsWith(rn + path.sep);
  });
  if (!hit) {
    throw new Error(
      `Path is outside the authorized local roots (${roots.join(', ')}). Ask the user to allow this location in ZENO_LOCAL_ROOTS.`
    );
  }
  return { target: wanted, root: hit };
}
