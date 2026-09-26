

import pg from 'pg';
import { logger } from '../core/logger.js';

const log = logger('db:postgres');

function translatePlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export class PostgresDriver {
  constructor(pool) {
    this.pool = pool;
    this.kind = 'postgres';
  }

  static open(connectionString) {
    const pool = new pg.Pool({ connectionString, max: 10 });
    return new PostgresDriver(pool);
  }

  exec(sql) {
    
    return this.pool.query(sql);
  }

  all(sql, params = []) {
    return this.pool.query(translatePlaceholders(sql), params).then((r) => r.rows);
  }

  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0];
  }

  async run(sql, params = []) {
    const r = await this.pool.query(translatePlaceholders(sql), params);
    return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id ?? null };
  }

  async healthCheck() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close() {
    await this.pool.end();
  }
}
