// System One — deterministic request classification.
//
// This is the DEFAULT implementation of the Jev decision layer: a pure,
// in-process feature extractor that turns one user request into a full
// structured routing decision (task type, complexity, execution mode, model
// tier, risk, verification level) in microseconds, with zero model calls.
//
// Design rules (harness spec §3-§5):
//   - Simple, self-contained requests stay in SIMPLE mode — no agent pipeline,
//     no tool catalog, no extra tokens.
//   - Tool-shaped requests route to AGENTIC mode; ambiguous ones FAIL OPEN to
//     agentic (the previous behavior) so a missed pattern can never strand a
//     request that needed tools.
//   - Every field is derived here in ONE pass — a single decision round, not a
//     chain of classifier calls.

export const TIERS = ['local', 'fast', 'balanced', 'reasoning', 'premium'];
export const COMPLEXITY_ORDER = { trivial: 0, simple: 1, medium: 2, complex: 3 };

// ── signal lexicons ───────────────────────────────────────────────────────────
// Ordered matters only within a list; matching is substring/token based and
// deliberately forgiving. These are decision hints, not gospel — the model
// still sees real tool results and can act outside this lane.

const RESEARCH = [
  'research', 'investigate', 'deep dive', 'state of', 'compare', 'comparison', 'versus', ' vs ',
  'pros and cons', 'market', 'trends', 'landscape', 'competitors', 'benchmark', 'survey',
  'sources', 'citations', 'report on', 'brief on', 'summarize the news', 'what happened',
  'latest developments', 'recent developments', 'news about', 'industry', 'analysis of',
];
const WEB = ['search', 'google', 'look up', 'lookup', 'find online', 'on the web', 'browse', 'scrape', 'http://', 'https://', 'www.'];
const CODE = [
  'code', 'function', 'bug', 'debug', 'stack trace', 'traceback', 'compile', 'refactor',
  'implement', 'unit test', 'test suite', 'npm ', 'pip install', 'javascript', 'typescript',
  'python script', 'regex', 'sql query', 'api integration', 'build me a', 'write a script',
  'fix the', 'error message', 'exception', 'dockerfile', 'class diagram', 'algorithm',
];
const FILE = ['my file', 'the file', 'workspace', 'save to', 'write to', 'read from', 'open the', 'folder', 'directory', 'spreadsheet', 'document at', '.txt', '.md', '.json', '.csv', '.docx', '.pdf'];
const COMPUTE = ['calculate', 'compute', 'variance', 'regression', 'dataset', 'simulate', 'parse this', 'convert this data', 'statistics', 'median', 'aggregate'];
const AUTOMATION = ['automate', 'schedule', 'every day', 'every week', 'cron', 'monitor', 'watch for', 'deploy', 'pipeline', 'batch job', 'nightly'];
const DATA = ['database', 'sql', 'query the', 'export', 'csv', 'json data', 'schema', 'records'];

const CHAT_DIRECT = [
  'what is', 'what are', 'who is', 'who was', 'why does', 'why is', 'how does', 'how do i',
  'explain', 'define', 'tell me about', 'difference between', 'meaning of', 'example of',
  'rewrite', 'rephrase', 'translate', 'proofread', 'summarize this', 'tl;dr', 'draft an email',
  'write a poem', 'brainstorm', 'ideas for', 'opinion', 'do you think', 'help me write',
  'help me phrase', 'can you explain', 'in your own words', 'shorten this', 'make this',
];
const GREETING = /^(hi|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|cool|nice|great|good morning|good afternoon|good evening|howdy|greetings)\b[\s!.?,-]*(there|zeno|again|mate|friend|team|all)?[\s!.?]*$/i;
const DESTRUCTIVE = ['delete', 'remove all', 'drop table', 'format', 'wipe', 'rm -rf', 'overwrite everything', 'purge', 'shutdown', 'reboot', 'purchase', 'pay', 'send money', 'transfer', 'publish', 'post publicly', 'email to'];
const FINANCIAL = ['purchase', 'buy', 'checkout', 'payment', 'invoice', 'refund', 'bank', 'wire transfer', 'crypto'];

const MULTI_STEP = ['first', 'then ', 'after that', 'afterwards', 'next,', 'step 1', 'step one', 'finally,', 'followed by', 'once that', 'subsequently'];

function countHits(haystack, needles) {
  let n = 0;
  for (const t of needles) if (haystack.includes(t)) n += 1;
  return n;
}

function complexityOf(q, { domainHits, multiStep, researchHits }) {
  if (q.length <= 24 && !multiStep && domainHits <= 1) return 'trivial';
  const words = q.split(/\s+/).length;
  let score = 0;
  if (words > 18) score += 1;
  if (words > 55) score += 1;
  if (multiStep) score += 1;
  if (domainHits >= 2) score += 1;
  if (researchHits >= 2) score += 1; // multi-facet research is never trivial
  if (/\b(all|every|comprehensive|exhaustive|thorough|complete|in depth|deep)\b/.test(q)) score += 1;
  if (score >= 4) return 'complex';
  if (score >= 2) return 'medium';
  if (score >= 1) return 'simple';
  return 'trivial';
}

/**
 * One-pass classification. Everything the orchestrator needs comes back in a
 * single structured object (spec §5: batch the decision round).
 *
 * opts: { hasTools, toolNames:Set<string>, hasAttachments, kind }
 */
export function classify(query, opts = {}) {
  const q = String(query || '').trim();
  const lower = q.toLowerCase();
  const hasTools = opts.hasTools !== false;
  const toolNames = opts.toolNames || new Set();
  const hasAttachments = !!opts.hasAttachments;
  const kind = opts.kind || 'chat';

  const researchHits = countHits(lower, RESEARCH);
  const webHits = countHits(lower, WEB);
  const codeHits = countHits(lower, CODE);
  const fileHits = countHits(lower, FILE);
  const computeHits = countHits(lower, COMPUTE);
  const autoHits = countHits(lower, AUTOMATION);
  const dataHits = countHits(lower, DATA);
  const chatHits = countHits(lower, CHAT_DIRECT);
  const url = /https?:\/\//.test(lower) || /^(www\.)/.test(lower);

  const multiStep = MULTI_STEP.some((m) => lower.includes(m)) && (researchHits || codeHits || fileHits || computeHits || autoHits);
  const domainHits = researchHits + webHits + codeHits + fileHits + computeHits + autoHits + dataHits;
  const complexity = complexityOf(q, { domainHits, multiStep, researchHits });

  // Task type: strongest tool-shaped signal wins; ties favor research (the
  // richest workflow) over generic web.
  const domains = [
    ['research', researchHits * 2 + webHits + (url ? 1 : 0)],
    ['code', codeHits * 2],
    ['file', fileHits * 2],
    ['data', dataHits * 2 + computeHits],
    ['automation', autoHits * 2],
    ['web', webHits],
  ].sort((a, b) => b[1] - a[1]);
  const [taskType, topScore] = domains[0][1] > 0 ? domains[0] : ['general', 0];

  // Execution mode. Chat when the request is clearly self-contained AND no
  // tool-shaped signal fires. Anything ambiguous fails OPEN to agentic.
  const isGreeting = GREETING.test(q);
  const shortConversational = q.length <= 160 && chatHits > 0 && topScore === 0 && !multiStep;
  const trivialChat = complexity === 'trivial' && topScore === 0 && !url && !hasAttachments;
  const wantsChat = isGreeting || shortConversational || (trivialChat && chatHits >= 0 && !/[\u0400-\u04FF\u4E00-\u9FFF]/.test(q));
  const executionMode = !hasTools ? 'chat' : wantsChat ? 'chat' : 'agent';

  // Confidence: how far the winning signal is from the alternative. High when
  // signals are unanimous; low (→ fail-open) when mixed.
  let confidence = 0.72;
  if (isGreeting) confidence = 0.95;
  else if (executionMode === 'chat' && shortConversational && !multiStep) confidence = 0.82;
  else if (executionMode === 'chat') confidence = 0.7;
  else if (topScore >= 4) confidence = 0.9;
  else if (topScore >= 2) confidence = 0.8;
  else if (chatHits > 0 && topScore > 0) confidence = 0.6;

  // Risk: destructive/financial verbs escalate, more when sensitive tools exist.
  const destructive = DESTRUCTIVE.some((d) => lower.includes(d));
  const financial = FINANCIAL.some((d) => lower.includes(d));
  const sensitiveAvailable = [...toolNames].some((n) => ['terminal', 'code_exec', 'http_request', 'file_delete', 'local_delete', 'local_write'].includes(n));
  const risk = financial || (destructive && sensitiveAvailable) ? 'high' : destructive || (sensitiveAvailable && executionMode === 'agent' && (autoHits > 0 || codeHits > 0)) ? 'medium' : 'low';

  // Model tier: minimum complexity that plausibly succeeds (spec §12).
  let modelTier = 'fast';
  if (complexity === 'simple') modelTier = 'fast';
  else if (complexity === 'medium') modelTier = taskType === 'code' ? 'reasoning' : 'balanced';
  else if (complexity === 'complex') modelTier = risk === 'high' ? 'premium' : 'reasoning';
  else modelTier = 'fast';
  if (toolNames.has('code_exec') && taskType === 'code' && complexity === 'medium') modelTier = 'balanced';

  // Verification level (spec §21: intelligent thresholds, not blanket checking).
  const verification =
    executionMode === 'chat' ? 'none'
      : risk === 'high' || complexity === 'complex' ? 'strict'
        : taskType === 'research' || taskType === 'data' || multiStep ? 'standard'
          : 'basic';

  const agent =
    taskType === 'research' || taskType === 'web' ? 'research'
      : taskType === 'code' ? 'coding'
        : taskType === 'data' ? 'data'
          : taskType === 'automation' ? 'automation'
            : 'general';

  return {
    taskType,
    complexity,
    executionMode,
    agent,
    skills: [],
    tools: [],
    parallel: taskType === 'research' || taskType === 'web' || taskType === 'data' || multiStep,
    verification,
    modelTier,
    risk,
    confidence,
    reason:
      isGreeting ? 'greeting/self-contained turn'
        : executionMode === 'chat' ? 'self-contained request; no tools needed'
          : `tool-shaped request (${taskType}, ${complexity}${multiStep ? ', multi-step' : ''})`,
    source: 'heuristic',
  };
}

/** Sanitize a decision coming from an external provider — never trust shape. */
export function coerceDecision(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  const tiers = new Set(TIERS);
  const d = { ...fallback };
  const str = (v, allowed, def) => (typeof v === 'string' && allowed.includes(v) ? v : def);
  d.taskType = str(raw.taskType, ['general', 'research', 'code', 'data', 'file', 'web', 'automation'], d.taskType);
  d.complexity = str(raw.complexity, ['trivial', 'simple', 'medium', 'complex'], d.complexity);
  d.executionMode = str(raw.executionMode, ['chat', 'agent'], d.executionMode);
  d.agent = typeof raw.agent === 'string' ? raw.agent.slice(0, 40) : d.agent;
  d.modelTier = str(raw.modelTier, [...tiers], d.modelTier);
  d.verification = str(raw.verification, ['none', 'basic', 'standard', 'strict'], d.verification);
  d.risk = str(raw.risk, ['low', 'medium', 'high'], d.risk);
  d.parallel = typeof raw.parallel === 'boolean' ? raw.parallel : d.parallel;
  const conf = Number(raw.confidence);
  d.confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : d.confidence;
  d.reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : d.reason;
  d.skills = Array.isArray(raw.skills) ? raw.skills.filter((s) => typeof s === 'string').slice(0, 6) : d.skills;
  d.tools = Array.isArray(raw.tools) ? raw.tools.filter((s) => typeof s === 'string').slice(0, 12) : d.tools;
  return d;
}
