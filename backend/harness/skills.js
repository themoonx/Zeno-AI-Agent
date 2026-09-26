



import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../core/config.js';
import { logger } from '../core/logger.js';

const log = logger('harness:skills');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const MAX_INSTRUCTIONS = 24_000;

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}


function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    meta[key] = ['triggers', 'tools'].includes(key)
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : value;
  }
  return { meta, body: match[2] };
}

let builtinCache = null;


export function builtinSkills({ reload = false } = {}) {
  if (builtinCache && !reload) return builtinCache;
  const out = [];
  try {
    for (const file of fs.readdirSync(SKILLS_DIR)) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const slug = meta.slug || slugify(path.basename(file, '.md'));
      const name = meta.name || slug;
      const instructions = body.trim();
      if (!instructions) continue;
      out.push({
        id: `builtin:${slug}`,
        slug,
        name,
        description: meta.description || '',
        instructions: instructions.slice(0, MAX_INSTRUCTIONS),
        triggers: meta.triggers || [],
        tools: meta.tools || [],
        enabled: true,
        source: 'builtin',
      });
    }
  } catch (err) {
    log.warn(`Could not read built-in skills: ${err.message}`);
  }
  builtinCache = out;
  return builtinCache;
}

function publicShape(skill) {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description || '',
    triggers: skill.triggers || [],
    tools: skill.tools || [],
    enabled: !!skill.enabled,
    source: skill.source || 'user',
    
    instructions: skill.instructions || '',
    createdAt: skill.createdAt || null,
    updatedAt: skill.updatedAt || null,
  };
}





const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'was', 'not']);

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}+#.]+/u)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}

export function scoreSkill(skill, requestText) {
  const tokens = tokenize(requestText);
  if (!tokens.size) return 0;
  let score = 0;
  for (const trigger of skill.triggers || []) {
    const t = String(trigger).toLowerCase().trim();
    if (!t) continue;
    
    if (t.includes(' ')) {
      if (String(requestText).toLowerCase().includes(t)) score += 3;
    } else if (tokens.has(t)) {
      score += 2;
    }
  }
  
  const nameTokens = tokenize(`${skill.name} ${skill.description}`);
  for (const t of tokens) if (nameTokens.has(t)) score += 0.5;
  return score;
}


export function matchSkills(skills, requestText, { limit = 3, minScore = 2 } = {}) {
  return skills
    .map((s) => ({ skill: s, score: scoreSkill(s, requestText) }))
    .filter((e) => e.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => ({ ...publicShape(e.skill), score: Number(e.score.toFixed(2)) }));
}

export { publicShape as publicSkill };
export const maxInstructions = MAX_INSTRUCTIONS;
export const skillsDir = SKILLS_DIR;
