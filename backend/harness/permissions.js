// Permission presets — single source of truth lives in policy/presets.js
// (presets are data compiled into enforcement; this module keeps the stored
// per-user preference reader). Re-exported here so existing call sites
// (chat routes, control routes, UI contracts) keep one import path.
import { PRESETS, PRESET_IDS, presetFor } from '../policy/presets.js';
import { logger } from '../core/logger.js';

const log = logger('permissions');

export const PERMISSION_MODES = PRESET_IDS;
export const MODE_LABELS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].label]));
export const MODE_DESCRIPTIONS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].description]));
export { presetFor };

/** The user's stored preset ('ask' is the safe default). */
export function permissionMode(repos, userId) {
  const stored = repos.users.getSetting(userId, 'permission_mode');
  return PRESET_IDS.includes(stored) ? stored : 'ask';
}

/** The user's Plan Mode preference (per-request overrides are allowed). */
export function planModeEnabled(repos, userId) {
  return repos.users.getSetting(userId, 'plan_mode') === true;
}

/** Human-readable one-liner for approval cards / audit entries. */
export function modeSummary(mode) {
  const p = presetFor(mode);
  return `${p.label}: ${p.description}`;
}
