
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  credentials TEXT,
  has_credentials INTEGER NOT NULL DEFAULT 0,
  extra_headers TEXT,
  params TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
  status_detail TEXT,
  status_checked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER,
  max_output_tokens INTEGER,
  capabilities TEXT,
  params TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_user ON models(user_id);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  system_prompt TEXT,
  provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  model_id TEXT,
  model_label TEXT,
  params TEXT,
  summary TEXT,                                  
  summary_upto_seq INTEGER,                      
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_message_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT,
  reasoning TEXT,
  usage TEXT,
  model_label TEXT,
  status TEXT NOT NULL DEFAULT 'complete',
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  model TEXT,
  allowed_tools TEXT,
  max_steps INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agent_name TEXT,
  project_id TEXT,
  task TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent',            
  conversation_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  plan TEXT,
  result TEXT,
  error TEXT,
  stats TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_user ON agent_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, seq);




CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                            
  conversation_id TEXT,                          
  run_id TEXT,                                   
  parent_session_id TEXT,                        
  status TEXT NOT NULL DEFAULT 'active',         
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation ON agent_sessions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_run ON agent_sessions(run_id);

CREATE TABLE IF NOT EXISTS agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,         
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,                            
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_events_user ON agent_events(user_id, seq);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scope TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id);

CREATE TABLE IF NOT EXISTS standing_approvals (
  user_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  scope_key TEXT,                                
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, tool)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  agent_id TEXT,
  conversation_id TEXT,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  embedding_model TEXT,
  source TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  expires_at INTEGER,
  superseded_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  tags TEXT,
  subject TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(user_id, project_id, agent_id);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  secret_enc TEXT,
  has_secret INTEGER NOT NULL DEFAULT 0,
  headers TEXT,
  schema_spec TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  tool_name TEXT,
  tool_description TEXT,
  status TEXT NOT NULL DEFAULT 'unverified',
  status_detail TEXT,
  status_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connectors_user ON connectors(user_id, created_at DESC);



CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  triggers TEXT,
  tools TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_user_slug ON skills(user_id, slug);



CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  manifest TEXT,
  secret_enc TEXT,
  has_secret INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'unverified',
  status_detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugins_user_slug ON plugins(user_id, slug);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  conversation_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  sha256 TEXT,
  kind TEXT NOT NULL,
  extracted_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  ip TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS jobs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_at INTEGER,
  last_error TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);




CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  effect TEXT NOT NULL,                          
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policy_rules_user ON policy_rules(user_id);



CREATE TABLE IF NOT EXISTS local_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  roots TEXT,
  status TEXT NOT NULL DEFAULT 'active',         
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_agents_user ON local_agents(user_id);


CREATE TABLE IF NOT EXISTS telemetry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  run_id TEXT,
  turn_id TEXT,
  call_id TEXT,
  kind TEXT NOT NULL,                              
  fields TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_kind ON telemetry(user_id, kind, ts DESC);


CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,                              
  task TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  project_id TEXT,
  model_id TEXT,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  max_retries INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id, created_at DESC);


CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  run_id TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (schedule_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs ON schedule_runs(schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_runs ON schedule_runs(schedule_id, created_at DESC);



CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT,
  run_id TEXT,
  turn_id TEXT,
  model_row_id TEXT,
  model_id TEXT,
  provider_id TEXT,
  purpose TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_user_day ON usage_ledger(user_id, day);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_turn ON usage_ledger(turn_id);




CREATE TABLE IF NOT EXISTS routing_stats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  task_type TEXT NOT NULL,
  turns INTEGER NOT NULL DEFAULT 0,
  escalations INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  decision_ms_total INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  est_cost_total REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_stats_user ON routing_stats(user_id, day DESC);

