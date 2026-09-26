


import { randomId } from '../core/crypto.js';
import { errors } from '../core/errors.js';
import { validate } from '../core/validate.js';
import { builtinSkills, slugify, publicSkill, maxInstructions } from './skills.js';

const MAX_USER_SKILLS = 200;

export function createSkillService({ repos, audit }) {
  function userRows(userId) {
    return repos.skills.listSkills(userId).map((s) => ({ ...s, source: s.source || 'user' }));
  }

  
  function all(userId) {
    const builtin = builtinSkills().map((s) => ({ ...s, id: s.id, source: 'builtin' }));
    const builtinSlugs = new Set(builtin.map((s) => s.slug));
    const user = userRows(userId).filter((s) => !builtinSlugs.has(s.slug));
    return [...builtin, ...user].map(publicSkill);
  }

  function enabled(userId) {
    return all(userId).filter((s) => s.enabled);
  }

  function get(userId, id) {
    const found = all(userId).find((s) => s.id === id);
    if (!found) throw errors.notFound('Skill');
    return found;
  }

  function assertOwned(userId, id) {
    if (String(id).startsWith('builtin:')) {
      throw errors.badRequest('Built-in skills are read-only. Create your own copy to customise it.');
    }
    const row = repos.skills.getSkill(userId, id);
    if (!row) throw errors.notFound('Skill');
    return row;
  }

  function create(userId, body) {
    const input = validate(body, {
      name: { type: 'string', required: true, min: 2, max: 80 },
      slug: { type: 'string', max: 64 },
      description: { type: 'string', max: 600 },
      instructions: { type: 'string', required: true, min: 10, max: maxInstructions },
      triggers: { type: 'array', items: { type: 'string' }, max: 40 },
      tools: { type: 'array', items: { type: 'string' }, max: 40 },
      enabled: { type: 'boolean', default: true },
    });
    const slug = slugify(input.slug || input.name);
    if (!slug) throw errors.badRequest('Skill name must contain letters or digits');
    if (builtinSkills().some((s) => s.slug === slug)) throw errors.conflict(`"${slug}" is a built-in skill — choose another name`);
    if (repos.skills.getBySlug(userId, slug)) throw errors.conflict(`A skill named "${slug}" already exists`);
    if (repos.skills.countSkills(userId) >= MAX_USER_SKILLS) throw errors.conflict('Skill limit reached');
    const id = randomId('skl');
    repos.skills.createSkill({
      id,
      userId,
      slug,
      name: input.name,
      description: input.description || null,
      instructions: input.instructions,
      triggers: (input.triggers || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 40),
      tools: input.tools || [],
      enabled: input.enabled,
      source: 'user',
    });
    audit({ userId, action: 'skill.create', target: id, meta: { slug } });
    return get(userId, id);
  }

  function update(userId, id, body) {
    const row = assertOwned(userId, id);
    const input = validate(body, {
      name: { type: 'string', min: 2, max: 80 },
      description: { type: 'string', max: 600 },
      instructions: { type: 'string', min: 10, max: maxInstructions },
      triggers: { type: 'array', items: { type: 'string' }, max: 40 },
      tools: { type: 'array', items: { type: 'string' }, max: 40 },
      enabled: { type: 'boolean' },
    });
    const fields = {};
    if (input.name !== undefined) fields.name = input.name;
    if (input.description !== undefined) fields.description = input.description;
    if (input.instructions !== undefined) fields.instructions = input.instructions;
    if (input.triggers !== undefined) {
      fields.triggers = input.triggers.map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 40);
    }
    if (input.tools !== undefined) fields.tools = input.tools;
    if (input.enabled !== undefined) fields.enabled = input.enabled ? 1 : 0;
    repos.skills.updateSkill(userId, row.id, fields);
    audit({ userId, action: 'skill.update', target: id, meta: { keys: Object.keys(fields) } });
    return get(userId, id);
  }

  function setEnabled(userId, id, enabled) {
    const row = assertOwned(userId, id);
    repos.skills.updateSkill(userId, row.id, { enabled: enabled ? 1 : 0 });
    audit({ userId, action: enabled ? 'skill.enable' : 'skill.disable', target: id });
    return get(userId, id);
  }

  function remove(userId, id) {
    const row = assertOwned(userId, id);
    repos.skills.deleteSkill(userId, row.id);
    audit({ userId, action: 'skill.delete', target: id, meta: { slug: row.slug } });
    return { ok: true };
  }

  return { all, enabled, get, create, update, setEnabled, remove, maxInstructions };
}