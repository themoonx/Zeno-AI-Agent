


export function parseCronField(field, min, max) {
  if (field === '*' || field === '?') return { any: true, values: null };
  const values = new Set();
  for (const part of String(field).split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`Invalid cron step in "${field}"`);
    let lo = min;
    let hi = max;
    if (rangePart !== '*' && rangePart !== '?') {
      if (rangePart.includes('-')) {
        const [a, b] = rangePart.split('-').map((x) => parseInt(x, 10));
        if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Invalid cron range in "${field}"`);
        lo = a;
        hi = b;
      } else {
        const v = parseInt(rangePart, 10);
        if (!Number.isFinite(v)) throw new Error(`Invalid cron value in "${field}"`);
        lo = hi = v;
      }
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron field "${field}" out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) values.add(v === 7 && max === 6 ? 0 : v);
  }
  if (!values.size) throw new Error(`Cron field "${field}" matches nothing`);
  return { any: false, values };
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields: "${expr}"`);
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    dom: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    dow: parseCronField(parts[4], 0, 6),
  };
}

export function cronMatches(expr, date) {
  const c = parseCron(expr);
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();
  
  const domOk = c.dom.any || c.dom.values.has(dom);
  const dowOk = c.dow.any || c.dow.values.has(dow);
  const dayOk = c.dom.any && c.dow.any ? true : c.dom.any ? dowOk : c.dow.any ? domOk : domOk && dowOk;
  return c.minute.any || c.minute.values.has(minute)
    ? (c.hour.any || c.hour.values.has(hour))
      ? (c.month.any || c.month.values.has(month))
        ? dayOk
        : false
      : false
    : false;
}


export function nextRun(expr, after = new Date()) {
  const cursor = new Date(after.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = after.getTime() + 366 * 24 * 3600 * 1000;
  while (cursor.getTime() < limit) {
    if (cronMatches(expr, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error(`Cron expression "${expr}" never fires`);
}