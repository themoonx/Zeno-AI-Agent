











import { logger } from '../core/logger.js';

const log = logger('verification');

const GRADER_SYSTEM =
  'You are a strict output verifier inside an AI agent system. Given the user request, the drafted answer, and (when present) the evidence the agent gathered, judge whether the answer is sound. Respond ONLY with JSON, no prose, no markdown:\n' +
  '{"ok": true|false, "confidence": 0.0-1.0, "issues": [{"claim": "short quote or claim", "problem": "why it is unsupported|contradicted|vague|incomplete"}]}\n' +
  'Rules: flag claims the evidence does not support, internal contradictions, and unanswered parts of the request. Do NOT flag style. Max 5 issues. If the answer is sound, return ok:true with an empty issues array.';

export function createVerificationEngine({ repos, gateway, modelRouter = null }) {
  
  function levelFor(decision, userId) {
    const stored = repos.users.getSetting(userId, 'verification') || {};
    const s = typeof stored === 'object' ? stored : {};
    if (s.enabled === false) return 'none';
    const fromDecision = decision?.verification || 'none';
    const floor = ['none', 'basic', 'standard', 'strict'].includes(s.minimum_level) ? s.minimum_level : null;
    const order = ['none', 'basic', 'standard', 'strict'];
    if (floor) return order.indexOf(fromDecision) >= order.indexOf(floor) ? fromDecision : floor;
    return fromDecision;
  }

  
  async function verify({ userId, decision = null, level, query, answer, evidenceDigest = null, modelRowId, signal, onUsage }) {
    const issues = [];
    let checker = 'deterministic';
    let confidence = 0.9;

    if (level === 'none') return { level, ok: true, issues, confidence: 1, checker };

    
    const text = String(answer || '');
    if (!text.trim()) issues.push({ claim: '(answer)', problem: 'The agent produced an empty answer after completing tool work.' });
    else if (text.trim().length < 60 && decision?.complexity === 'complex') {
      issues.push({ claim: '(answer)', problem: 'Suspiciously short answer for a complex request.' });
    }
    if (decision?.taskType === 'research' && evidenceDigest) {
      const sources = [...evidenceDigest.matchAll(/https?:\/\/[^\s)"']+/g)].map((m) => m[0]);
      if (sources.length && !sources.some((u) => text.includes(u.replace(/\/$/, '')))) {
        issues.push({ claim: '(citations)', problem: 'Research answer cites none of the sources it actually read.' });
      }
      if (/\b(definitely|guaranteed|100% certain|always the case)\b/i.test(text)) {
        issues.push({ claim: '(certainty)', problem: 'Absolute certainty language in a research answer should be hedged or cited.' });
      }
    }
    if (level === 'basic') {
      return { level, ok: issues.length === 0, issues, confidence: issues.length ? 0.6 : 0.95, checker };
    }

    // ── standard/strict: one grader call on the verification-tier model ─────
    let graderOk = null;
    let graderConfidence = null;
    try {
      const { text: raw } = await gateway.complete({
        userId,
        modelRowId,
        messages: [
          { role: 'system', content: GRADER_SYSTEM },
          {
            role: 'user',
            content:
              `User request:\n${String(query).slice(0, 3000)}\n\n` +
              `Drafted answer:\n${text.slice(0, 8000)}\n\n` +
              (evidenceDigest ? `Evidence gathered (digest):\n${evidenceDigest.slice(0, 6000)}\n\n` : '') +
              'Verify now. JSON only.',
          },
        ],
        timeoutMs: 45_000,
        onUsage: onUsage || null,
      });
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        graderOk = parsed.ok !== false;
        graderConfidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0.75;
        for (const issue of Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5) : []) {
          if (issue && (issue.problem || typeof issue === 'string')) {
            issues.push(typeof issue === 'string' ? { claim: '(answer)', problem: issue } : { claim: String(issue.claim || '(answer)').slice(0, 200), problem: String(issue.problem).slice(0, 300) });
          }
        }
      }
      checker = 'grader-model';
    } catch (err) {
      log.warn(`grader call failed, falling back to deterministic verdict: ${err.message}`);
      return { level, ok: issues.length === 0, issues, confidence: 0.7, checker: 'deterministic', skipped: true };
    }

    // ── strict additions: numeric/date contradiction scan against evidence ──
    if (level === 'strict' && evidenceDigest && graderOk !== false) {
      const contradicted = numericContradictions(text, evidenceDigest);
      for (const c of contradicted.slice(0, 3)) issues.push({ claim: c.claim, problem: c.problem });
      if (contradicted.length) checker = 'grader-model+scan';
    }

    const ok = graderOk !== false && issues.length === 0;
    confidence = graderConfidence ?? (ok ? 0.85 : 0.5);
    return { level, ok, issues, confidence, checker };
  }

  /**
   * Deterministic strict-mode scan: numbers/dates asserted in the answer that
   * do not appear anywhere in the evidence digest are suspects (too weak to
   * fail on its own — it adds issues that only matter when the grader passed).
   */
  function numericContradictions(answer, evidence) {
    const out = [];
    const evidenceNums = new Set(String(evidence).match(/\d[\d.,:%]*/g) || []);
    const claims = String(answer).match(/\b(?:\d{1,4}(?:[.,]\d+)?%?|\d{4}-\d{2}-\d{2})\b/g) || [];
    const seen = new Set();
    for (const raw of claims) {
      const norm = raw.replace(/[.,]$/, '');
      if (seen.has(norm)) continue;
      seen.add(norm);
      const loose = norm.replace(/[.,%]/g, '');
      const present = [...evidenceNums].some((e) => e.replace(/[.,%]/g, '') === loose);
      if (!present && norm.length >= 2) {
        out.push({ claim: norm, problem: 'Figure not present in the gathered evidence — verify or hedge it.' });
      }
      if (out.length >= 3) break;
    }
    return out;
  }

  return { levelFor, verify, numericContradictions };
}
