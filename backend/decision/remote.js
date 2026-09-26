













import { decryptSecret } from '../core/crypto.js';

const DECISION_SCHEMA_HINT = {
  taskType: 'general|research|code|data|file|web|automation',
  complexity: 'trivial|simple|medium|complex',
  executionMode: 'chat|agent',
  agent: 'general|research|coding|data|automation',
  parallel: true,
  verification: 'none|basic|standard|strict',
  modelTier: 'local|fast|balanced|reasoning|premium',
  risk: 'low|medium|high',
  confidence: 0.0,
  reason: 'short',
};

const SYSTEM_PROMPT =
  'You are the routing layer of an AI agent system (System One). Classify the user request and return ONLY a JSON object, no prose, no markdown, exactly this shape:\n' +
  JSON.stringify(DECISION_SCHEMA_HINT) +
  '\nRules: executionMode "chat" ONLY for self-contained requests (explanations, rewriting, translation, brainstorming, casual conversation) that need no tools. Anything involving web research, files, code execution, external APIs, multiple steps, or automation is "agent". modelTier is the MINIMUM capability tier that can succeed: trivial/simple -> fast, medium -> balanced (code -> reasoning), complex -> reasoning or premium. verification "none" for chat, "basic" for simple agent work, "standard" for research/data, "strict" for complex or high-risk tasks. confidence in [0,1].';

function firstJson(text) {
  const fenced = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : String(text || '');
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function createRemoteDecisionProvider({ settings }) {
  const endpoint = String(settings.endpoint || '').trim();
  const mode = settings.mode === 'openai' ? 'openai' : 'json';
  const apiKey = settings.api_key ? decryptSecret(settings.api_key) : null;
  const model = String(settings.model || '').trim() || null;
  const timeoutMs = Math.max(250, Math.min(10_000, Number(settings.timeout_ms) || 2500));

  const configured = !!endpoint && (mode !== 'openai' || !!model);

  async function decide({ query, context }) {
    if (!configured) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let raw;
      if (mode === 'openai') {
        const base = endpoint.replace(/\/+$/, '');
        const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({ query: String(query).slice(0, 2000), context }),
              },
            ],
            temperature: 0,
            max_tokens: 300,
            ...(settings.extra_params || {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        raw = firstJson(data?.choices?.[0]?.message?.content);
      } else {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ query: String(query).slice(0, 2000), context, schema: DECISION_SCHEMA_HINT }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        raw = data?.decision && typeof data.decision === 'object' ? data.decision : data;
      }
      return raw && typeof raw === 'object' ? raw : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { decide, configured, mode, endpoint, timeoutMs };
}
