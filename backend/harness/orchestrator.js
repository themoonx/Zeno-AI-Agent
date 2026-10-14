// Turn orchestrator. Given a request and the user's available capabilities,
// decide what to offer the model for this turn:
//
//   - which skills' instructions to inject (matching, bounded)
//   - which capabilities to highlight as most relevant
//   - whether tools are worth offering at all
//
// It never decides WHICH tool to call — that is the model's job, and the model
// sees real tool results. This layer only shapes availability and attention, so
// a direct question stays a direct answer and a research task arrives with the
// research method already loaded.
import { matchSkills } from './skills.js';

// Capability groups the prompt describes, in the order they are introduced.
const GROUPS = [
  { id: 'internet', label: 'Internet & research', tools: ['web_search', 'browser_read', 'http_request'] },
  { id: 'workspace', label: 'Workspace files', tools: ['file_read', 'file_list', 'file_write', 'file_edit', 'file_delete'] },
  { id: 'local', label: 'Local computer', tools: ['local_read', 'local_list', 'local_write', 'local_edit', 'local_delete'] },
  { id: 'compute', label: 'Compute', tools: ['code_exec', 'terminal'] },
  { id: 'memory', label: 'Memory', tools: ['memory_search', 'memory_write'] },
];

function groupOf(toolName, origin) {
  for (const g of GROUPS) if (g.tools.includes(toolName)) return g.id;
  if (origin?.kind === 'connector') return 'connections';
  if (origin?.kind === 'plugin') return 'plugins';
  return 'other';
}

/**
 * Should tools be offered at all for this request? Offering a tool catalog to a
 * model that only needs to answer costs tokens and invites needless calls, but
 * withholding it breaks act-on-demand. We only skip tools for clearly
 * self-contained requests — a greeting or a pure writing task — and never when
 * the user has their own capabilities enabled and may expect them to be used.
 */
function shouldOfferTools(query, schemas) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  // Very short pure-greeting / acknowledgement turns: a tool catalog would only
  // add cost and invite a pointless call.
  const shortGreeting = /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|cool|nice|great|good morning|good afternoon|good evening)\b(?:\s+(?:there|zeno|again|mate|friend))?[.!?\s]*$/;
  if (q.length <= 32 && shortGreeting.test(q)) return false;
  return schemas.length > 0;
}

export function planTurn({ query, schemas, skills, settings, guidance = '' }) {
  const toolNames = new Set(schemas.map((s) => s.name));
  const originByName = new Map(schemas.map((s) => [s.name, s.origin]));

  const matched = settings.auto_skills === false
    ? []
    : matchSkills(
        skills.filter((s) => s.enabled && s.instructions),
        query,
        { limit: Math.max(0, Math.min(6, Number(settings.max_matched_skills) || 3)) }
      );

  // Which capability groups have at least one available tool.
  const availableGroups = new Map();
  for (const s of schemas) {
    const gid = groupOf(s.name, s.origin);
    if (!availableGroups.has(gid)) availableGroups.set(gid, []);
    availableGroups.get(gid).push(s.name);
  }

  return {
    matchedSkills: matched,
    matchedSkillSlugs: matched.map((s) => s.slug),
    offerTools: shouldOfferTools(query, schemas),
    toolCount: schemas.length,
    groups: [...availableGroups.entries()].map(([id, names]) => ({
      id,
      label: GROUPS.find((g) => g.id === id)?.label || (id === 'connections' ? 'Your connections' : id === 'plugins' ? 'Plugins' : 'Other'),
      tools: names,
    })),
    guidance,
    autoOrchestrate: settings.auto_orchestrate !== false,
    originByName,
    toolNames,
  };
}

/**
 * The "what you can do" block for the system prompt. Describes capabilities by
 * group rather than dumping a flat tool list, which keeps long catalogs legible
 * for the model and makes it obvious when a user's own connections are present.
 */
export function capabilityPromptBlock(schemas, plan) {
  if (!schemas.length) return '';
  const lines = [];
  const byGroup = new Map();
  for (const s of schemas) {
    const gid = groupOf(s.name, s.origin);
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(s);
  }
  for (const [gid, list] of byGroup) {
    const label = GROUPS.find((g) => g.id === gid)?.label ||
      (gid === 'connections' ? 'The user\'s own connections (MCP servers & HTTP plugins)' :
       gid === 'plugins' ? 'Installed plugins' : 'Additional capabilities');
    lines.push(`${label}:`);
    for (const t of list) {
      lines.push(`  - ${t.name}${t.sensitive ? ' (requires human approval)' : ''}: ${t.description}`);
    }
  }
  return lines.join('\n');
}

export { groupOf, shouldOfferTools };