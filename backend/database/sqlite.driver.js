

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../core/logger.js';

const log = logger('db:sqlite');

export class SqliteDriver {
  constructor(db) {
    this.db = db;
    this.kind = 'sqlite';
  }

  static open(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    return new SqliteDriver(db);
  }

  exec(sql) {
    this.db.exec(sql);
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: Number(info.changes), lastInsertRowid: info.lastInsertRowid };
  }

  healthCheck() {
    this.get('SELECT 1 AS ok');
    return true;
  }
}
