


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
    
    return typeof value === 'string' ? value : fallback;
  }
}

export function now() {
  return Date.now();
}
