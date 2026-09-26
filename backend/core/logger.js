
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.ZENO_LOG_LEVEL || (config.env === 'production' ? 'info' : 'debug')] || 20;

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < minLevel) return;
  const time = new Date().toISOString();
  if (config.env === 'production') {
    const rec = { t: time, level, scope, msg };
    if (extra !== undefined) rec.extra = extra instanceof Error ? { message: extra.message, stack: extra.stack } : extra;
    process.stdout.write(JSON.stringify(rec) + '\n');
  } else {
    const tag = `\x1b[2m${time.slice(11, 23)}\x1b[0m ${colorFor(level)}${level.toUpperCase().padEnd(5)}\x1b[0m \x1b[36m${scope}\x1b[0m`;
    let line = `${tag} ${msg}`;
    if (extra instanceof Error) line += ` — ${extra.stack || extra.message}`;
    else if (extra !== undefined) line += ` ${JSON.stringify(extra)}`;
    process.stdout.write(line + '\n');
  }
}

function colorFor(level) {
  return { debug: '\x1b[90m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' }[level] || '';
}

export function logger(scope) {
  return {
    debug: (msg, extra) => emit('debug', scope, msg, extra),
    info: (msg, extra) => emit('info', scope, msg, extra),
    warn: (msg, extra) => emit('warn', scope, msg, extra),
    error: (msg, extra) => emit('error', scope, msg, extra),
  };
}
