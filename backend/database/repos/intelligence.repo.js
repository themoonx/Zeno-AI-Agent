



import { now } from '../helpers.js';

export function createIntelligenceRepo(db) {
  return {
    
    recordUsage({ id, userId, sessionId, runId, turnId, modelRowId, modelId, providerId, purpose, inputTokens, outputTokens, estCostUsd }) {
      const ts = now();
      const day = new Date(ts).toISOString().slice(0, 10);
      db.run(
        `INSERT INTO usage_ledger (id, user_id, session_id, run_id, turn_id, model_row_id, model_id, provider_id, purpose, input_tokens, output_tokens, est_cost_usd, day, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, sessionId || null, runId || null, turnId || null, modelRowId || null, modelId || null, providerId || null, purpose || null, inputTokens || 0, outputTokens || 0, estCostUsd || 0, day, ts]
      );
    },
    usageDaySpend(userId, day) {
      const row = db.get(
        'SELECT COALESCE(SUM(est_cost_usd), 0) AS cost, COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS tokens_in, COALESCE(SUM(output_tokens), 0) AS tokens_out FROM usage_ledger WHERE user_id = ? AND day = ?',
        [userId, day]
      );
      return { cost: Number(row.cost) || 0, requests: Number(row.requests) || 0, tokensIn: Number(row.tokens_in) || 0, tokensOut: Number(row.tokens_out) || 0 };
    },
    usageMonthSpend(userId, monthPrefix) {
      const row = db.get(
        "SELECT COALESCE(SUM(est_cost_usd), 0) AS cost, COUNT(*) AS requests FROM usage_ledger WHERE user_id = ? AND day LIKE ? || '%'",
        [userId, monthPrefix]
      );
      return { cost: Number(row.cost) || 0, requests: Number(row.requests) || 0 };
    },
    turnCost(turnId) {
      const row = db.get(
        'SELECT COALESCE(SUM(est_cost_usd), 0) AS cost, COALESCE(SUM(input_tokens), 0) AS tokens_in, COALESCE(SUM(output_tokens), 0) AS tokens_out FROM usage_ledger WHERE turn_id = ?',
        [turnId]
      );
      return { cost: Number(row.cost) || 0, promptTokens: Number(row.tokens_in) || 0, completionTokens: Number(row.tokens_out) || 0 };
    },
    usageSummary(userId) {
      const day = new Date().toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const today = this.usageDaySpend(userId, day);
      const monthRow = this.usageMonthSpend(userId, month);
      const byDay = db
        .all(
          `SELECT day, SUM(est_cost_usd) AS cost, SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out, COUNT(*) AS requests
           FROM usage_ledger WHERE user_id = ? AND day >= ?
           GROUP BY day ORDER BY day ASC`,
          [userId, new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10)]
        )
        .map((r) => ({ day: r.day, cost: Number(r.cost) || 0, tokensIn: Number(r.tokens_in) || 0, tokensOut: Number(r.tokens_out) || 0, requests: Number(r.requests) || 0 }));
      const byModel = db
        .all(
          `SELECT model_id, COUNT(*) AS requests, SUM(input_tokens) AS tokens_in, SUM(output_tokens) AS tokens_out, SUM(est_cost_usd) AS cost
           FROM usage_ledger WHERE user_id = ? AND ts >= ?
           GROUP BY model_id ORDER BY cost DESC LIMIT 10`,
          [userId, now() - 30 * 86_400_000]
        )
        .map((r) => ({ modelId: r.model_id || 'unknown', requests: Number(r.requests) || 0, tokensIn: Number(r.tokens_in) || 0, tokensOut: Number(r.tokens_out) || 0, cost: Number(r.cost) || 0 }));
      return { today, month: monthRow, byDay, byModel };
    },

    
    getRoutingStatsRow(userId, day, taskType) {
      return db.get('SELECT * FROM routing_stats WHERE user_id = ? AND day = ? AND task_type = ?', [userId, day, taskType]);
    },
    insertRoutingStats({ userId, day, taskType, turns, escalations, failures, decisionMsTotal, tokensTotal, estCostTotal }) {
      db.run(
        'INSERT INTO routing_stats (id, user_id, day, task_type, turns, escalations, failures, decision_ms_total, tokens_total, est_cost_total, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [`${userId}:${day}:${taskType}`, userId, day, taskType, turns, escalations, failures, decisionMsTotal, tokensTotal, estCostTotal, now()]
      );
    },
    updateRoutingStats(id, { turns, escalations, failures, decisionMsTotal, tokensTotal, estCostTotal }) {
      db.run(
        'UPDATE routing_stats SET turns = ?, escalations = ?, failures = ?, decision_ms_total = ?, tokens_total = ?, est_cost_total = ?, updated_at = ? WHERE id = ?',
        [turns, escalations, failures, decisionMsTotal, tokensTotal, estCostTotal, now(), id]
      );
    },
    routingStats(userId, { days = 14 } = {}) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      return db
        .all('SELECT * FROM routing_stats WHERE user_id = ? AND day >= ? ORDER BY day DESC', [userId, since])
        .map((r) => ({
          id: r.id,
          day: r.day,
          taskType: r.task_type,
          turns: Number(r.turns) || 0,
          escalations: Number(r.escalations) || 0,
          failures: Number(r.failures) || 0,
          decision_ms_total: Number(r.decision_ms_total) || 0,
          tokens_total: Number(r.tokens_total) || 0,
          est_cost_total: Number(r.est_cost_total) || 0,
        }));
    },
    resetRoutingStats(userId) {
      db.run('DELETE FROM routing_stats WHERE user_id = ?', [userId]);
    },
  };
}
