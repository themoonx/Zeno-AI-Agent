









export const PRESETS = {
  ask: {
    id: 'ask',
    label: 'Ask Before Change',
    description: 'Sensitive actions pause for your approval, inline in chat.',
    autoClasses: [], 
  },
  edit_auto: {
    id: 'edit_auto',
    label: 'Edit Automatically',
    description: 'File reads, writes, edits, and deletes run without asking — in the workspace and in authorized local roots. Everything else still asks.',
    autoClasses: ['fs.read', 'fs.write', 'fs.delete'],
  },
  workspace: {
    id: 'workspace',
    label: 'Workspace Edit',
    description: 'Workspace files are created, edited, and deleted automatically. Everything outside the workspace — and every shell, network, or connector action — still asks.',
    autoClasses: [], 
    workspaceSafeAuto: true,
  },
  full: {
    id: 'full',
    label: 'Full Access',
    description: 'Everything runs without approval — including terminal, code execution, and your local computer. Only use in environments you trust.',
    autoClasses: ['*'],
  },
};

export const PRESET_IDS = Object.keys(PRESETS);


export const MODE_LABELS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].label]));
export const MODE_DESCRIPTIONS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].description]));

export function presetFor(mode) {
  return PRESETS[mode] || PRESETS.ask;
}


export function presetBaseline(preset, actionClass, tool) {
  if (preset.autoClasses.includes('*')) return 'allow';
  if (preset.autoClasses.includes(actionClass)) return 'allow';
  if (preset.workspaceSafeAuto && tool?.workspaceSafe) return 'allow';
  return 'ask';
}