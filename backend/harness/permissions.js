



import { PRESETS, PRESET_IDS, presetFor } from '../policy/presets.js';
import { logger } from '../core/logger.js';

const log = logger('permissions');

export const PERMISSION_MODES = PRESET_IDS;
export const MODE_LABELS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].label]));
export const MODE_DESCRIPTIONS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].description]));
export { presetFor };


export function permissionMode(repos, userId) {
  const stored = repos.users.getSetting(userId, 'permission_mode');
  return PRESET_IDS.includes(stored) ? stored : 'ask';
}


export function planModeEnabled(repos, userId) {
  return repos.users.getSetting(userId, 'plan_mode') === true;
}


export function modeSummary(mode) {
  const p = presetFor(mode);
  return `${p.label}: ${p.description}`;
}
