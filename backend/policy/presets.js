// Permission presets — user-facing choices compiled into policy behaviour.
// Presets are DATA: each one declares its baseline decisions. The engine reads
// them; nothing in the UI or the executor hardcodes a mode.
//
//   ask          Ask Before Change — every sensitive action waits for a human.
//   edit_auto    Edit Automatically — file edits/writes run without asking
//                anywhere the policy rules permit (workspace AND authorized
//                local roots); shell, network, and connectors still ask.
//   workspace    Workspace Edit — auto only INSIDE the private workspace.
//   full         Full Access — nothing asks.
export const PRESETS = {
  ask: {
    id: 'ask',
    label: 'Ask Before Change',
    description: 'Sensitive actions pause for your approval, inline in chat.',
    autoClasses: [], // nothing auto-approves
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
    autoClasses: [], // uses the tool's workspaceSafe flag instead
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

// Derived labels/description maps (the shape older call sites consume).
export const MODE_LABELS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].label]));
export const MODE_DESCRIPTIONS = Object.fromEntries(PRESET_IDS.map((id) => [id, PRESETS[id].description]));

export function presetFor(mode) {
  return PRESETS[mode] || PRESETS.ask;
}

/** Baseline decision a preset gives an action class before user rules apply. */
export function presetBaseline(preset, actionClass, tool) {
  if (preset.autoClasses.includes('*')) return 'allow';
  if (preset.autoClasses.includes(actionClass)) return 'allow';
  if (preset.workspaceSafeAuto && tool?.workspaceSafe) return 'allow';
  return 'ask';
}