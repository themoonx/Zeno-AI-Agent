




import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../core/config.js';
import { logger } from '../core/logger.js';
import { SqliteDriver } from './sqlite.driver.js';
import { PostgresDriver } from './postgres.driver.js';
import { createUsersRepo } from './repos/users.repo.js';
import { createProvidersRepo } from './repos/providers.repo.js';
import { createChatRepo } from './repos/chat.repo.js';
import { createProjectsRepo, createAgentsRepo } from './repos/projects.repo.js';
import { createRunsRepo } from './repos/runs.repo.js';
import { createMemoryRepo } from './repos/memory.repo.js';
import { createFilesRepo, createOpsRepo } from './repos/ops.repo.js';
import { createConnectorsRepo } from './repos/connectors.repo.js';
import { createSkillsRepo } from './repos/skills.repo.js';
import { createPluginsRepo } from './repos/plugins.repo.js';
import { createPolicyRepo, createLocalAgentsRepo } from './repos/policy.repo.js';
import { createSessionsRepo } from './repos/sessions.repo.js';
import { createIntelligenceRepo } from './repos/intelligence.repo.js';
import { createSchedulesRepo } from '../scheduler/index.js';

const log = logger('db');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export let db;
export let repos;

export async function initDatabase() {
  ensureDataDirs();
  if (config.databaseUrl) {
    log.info('Connecting to PostgreSQL…');
    db = PostgresDriver.open(config.databaseUrl);
  } else {
    const file = path.join(config.dataDir, 'zeno.db');
    log.info(`Using embedded SQLite at ${file}`);
    db = SqliteDriver.open(file);
  }

  await applySchema();
  await repairAgentEventsForeignKey();
  await applyMigrations();

  db.requeueStale?.();

  repos = {
    users: createUsersRepo(db),
    providers: createProvidersRepo(db),
    chat: createChatRepo(db),
    projects: createProjectsRepo(db),
    agents: createAgentsRepo(db),
    runs: createRunsRepo(db),
    memory: createMemoryRepo(db),
    files: createFilesRepo(db),
    ops: createOpsRepo(db),
    connectors: createConnectorsRepo(db),
    skills: createSkillsRepo(db),
    plugins: createPluginsRepo(db),
    policy: createPolicyRepo(db),
    localAgents: createLocalAgentsRepo(db),
    sessions: createSessionsRepo(db),
    intelligence: createIntelligenceRepo(db),
    schedules: createSchedulesRepo(db),
  };

  log.info(`Database ready (${db.kind})`);
  return { db, repos };
}

async function applySchema() {
  const file = db.kind === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql';
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
  try {
    if (db.kind === 'postgres') {
      
      const statements = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await db.exec(stmt);
      }
    } else {
      db.exec(sql);
    }
  } catch (err) {
    log.error(`Schema application failed: ${err.message}`);
    throw err;
  }
}





async function repairAgentEventsForeignKey() {
  try {
    if (db.kind === 'postgres') {
      const broken = db.all(
        `SELECT tc.constraint_name FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
         WHERE tc.table_name = 'agent_events' AND tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'sessions'`
      );
      for (const row of broken) {
        db.exec(`ALTER TABLE agent_events DROP CONSTRAINT "${row.constraint_name}"`);
        db.exec('ALTER TABLE agent_events ADD CONSTRAINT agent_events_session_fk FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE');
        log.info(`migrated: agent_events FK ${row.constraint_name} → agent_sessions`);
      }
      return;
    }
    const fks = db.all('PRAGMA foreign_key_list(agent_events)');
    if (!fks.some((fk) => String(fk.table).toLowerCase() === 'sessions')) return;
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`CREATE TABLE agent_events_repaired (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT
    )`);
    db.exec('INSERT INTO agent_events_repaired (seq, session_id, user_id, ts, type, data) SELECT seq, session_id, user_id, ts, type, data FROM agent_events');
    db.exec('DROP TABLE agent_events');
    db.exec('ALTER TABLE agent_events_repaired RENAME TO agent_events');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id, seq)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id, seq)');
    db.exec('PRAGMA foreign_keys = ON');
    log.info('migrated: agent_events FK now references agent_sessions');
  } catch (err) {
    log.error(`agent_events FK repair failed: ${err.message}`);
    throw err;
  }
}



async function applyMigrations() {
  const steps = [
    {
      table: 'memories',
      columns: {
        importance: db.kind === 'postgres' ? "ALTER TABLE memories ADD COLUMN IF NOT EXISTS importance REAL NOT NULL DEFAULT 0.5" : "ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 0.5",
        confidence: db.kind === 'postgres' ? "ALTER TABLE memories ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.8" : "ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8",
        access_count: db.kind === 'postgres' ? "ALTER TABLE memories ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0" : "ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0",
        last_accessed_at: db.kind === 'postgres' ? 'ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_accessed_at INTEGER' : 'ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER',
        expires_at: db.kind === 'postgres' ? 'ALTER TABLE memories ADD COLUMN IF NOT EXISTS expires_at INTEGER' : 'ALTER TABLE memories ADD COLUMN expires_at INTEGER',
        superseded_by: db.kind === 'postgres' ? 'ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded_by TEXT' : 'ALTER TABLE memories ADD COLUMN superseded_by TEXT',
        status: db.kind === 'postgres' ? "ALTER TABLE memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'" : "ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
        tags: db.kind === 'postgres' ? 'ALTER TABLE memories ADD COLUMN IF NOT EXISTS tags JSONB' : 'ALTER TABLE memories ADD COLUMN tags TEXT',
        subject: db.kind === 'postgres' ? 'ALTER TABLE memories ADD COLUMN IF NOT EXISTS subject TEXT' : 'ALTER TABLE memories ADD COLUMN subject TEXT',
      },
    },
    {
      table: 'agent_runs',
      columns: {
        kind: db.kind === 'postgres' ? "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'agent'" : "ALTER TABLE agent_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'",
        conversation_id: db.kind === 'postgres' ? 'ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS conversation_id TEXT' : 'ALTER TABLE agent_runs ADD COLUMN conversation_id TEXT',
      },
    },
    {
      table: 'standing_approvals',
      columns: {
        scope_key: db.kind === 'postgres' ? 'ALTER TABLE standing_approvals ADD COLUMN IF NOT EXISTS scope_key TEXT' : 'ALTER TABLE standing_approvals ADD COLUMN scope_key TEXT',
      },
      after() {
        db.exec('CREATE INDEX IF NOT EXISTS idx_standing_scope ON standing_approvals(user_id, scope_key, tool)');
      },
    },
    {
      table: 'conversations',
      columns: {
        summary: db.kind === 'postgres' ? 'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT' : 'ALTER TABLE conversations ADD COLUMN summary TEXT',
        summary_upto_seq: db.kind === 'postgres' ? 'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary_upto_seq INTEGER' : 'ALTER TABLE conversations ADD COLUMN summary_upto_seq INTEGER',
      },
    },
  ];
  for (const step of steps) {
    const existing = new Set(
      db.all(
        db.kind === 'postgres'
          ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${step.table}'`
          : `PRAGMA table_info(${step.table})`
      ).map((r) => (r.name || r.column_name).toLowerCase())
    );
    for (const [column, ddl] of Object.entries(step.columns)) {
      if (existing.has(column)) continue;
      try {
        db.run(ddl);
        log.info(`migrated: added ${step.table}.${column}`);
      } catch (err) {
        log.warn(`migration for ${step.table}.${column} failed: ${err.message}`);
      }
    }
    try {
      step.after?.();
    } catch (err) {
      log.warn(`post-migration for ${step.table} failed: ${err.message}`);
    }
  }
}
