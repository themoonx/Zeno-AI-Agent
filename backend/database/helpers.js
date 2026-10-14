// JSON column helpers shared by repositories. JSONB comes back parsed from
// Postgres; SQLite stores TEXT and comes back as strings — normalize here.

export function j(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function pj(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    // Plain strings are stored verbatim (j() doesn't quote them) — return as-is.
    return typeof value === 'string' ? value : fallback;
  }
}

export function now() {
  return Date.now();
}
