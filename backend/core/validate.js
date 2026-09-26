


import { errors } from './errors.js';

const TYPES = ['string', 'number', 'boolean', 'array', 'object'];

export function validate(body, schema) {
  const out = {};
  const problems = [];
  if (body == null || typeof body !== 'object') body = {};
  for (const [name, rule] of Object.entries(schema)) {
    let v = body[name];
    if (v === undefined || v === null || v === '') {
      if (rule.required) problems.push(`${name} is required`);
      else if ('default' in rule) out[name] = rule.default;
      continue;
    }
    if (rule.type && !TYPES.includes(rule.type)) continue;
    switch (rule.type) {
      case 'string':
        if (typeof v !== 'string') { problems.push(`${name} must be a string`); continue; }
        v = v.trim();
        if (rule.min && v.length < rule.min) { problems.push(`${name} must be at least ${rule.min} characters`); continue; }
        if (rule.max && v.length > rule.max) { problems.push(`${name} must be at most ${rule.max} characters`); continue; }
        if (rule.pattern && !rule.pattern.test(v)) { problems.push(rule.patternMessage || `${name} has an invalid format`); continue; }
        if (rule.enum && !rule.enum.includes(v)) { problems.push(`${name} must be one of: ${rule.enum.join(', ')}`); continue; }
        break;
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) { problems.push(`${name} must be a number`); continue; }
        if (rule.min !== undefined && n < rule.min) { problems.push(`${name} must be ≥ ${rule.min}`); continue; }
        if (rule.max !== undefined && n > rule.max) { problems.push(`${name} must be ≤ ${rule.max}`); continue; }
        v = n;
        break;
      }
      case 'boolean':
        if (typeof v === 'string') v = v === 'true';
        if (typeof v !== 'boolean') { problems.push(`${name} must be a boolean`); continue; }
        break;
      case 'array':
        if (!Array.isArray(v)) { problems.push(`${name} must be an array`); continue; }
        if (rule.max && v.length > rule.max) { problems.push(`${name} must have at most ${rule.max} items`); continue; }
        if (rule.items?.type === 'string') v = v.map((x) => String(x));
        if (rule.items?.type === 'number') v = v.map((x) => Number(x));
        break;
      case 'object':
        if (typeof v !== 'object' || Array.isArray(v)) { problems.push(`${name} must be an object`); continue; }
        break;
    }
    out[name] = v;
  }
  if (problems.length) throw errors.badRequest(problems[0], { problems });
  return out;
}
