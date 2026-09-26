



















import { randomId } from '../core/crypto.js';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';

const log = logger('memory');



function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'was', 'not', 'his', 'her', 'their', 'have', 'has']);

function keywords(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}


function jaccard(a, b) {
  const A = keywords(a);
  const B = keywords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function keywordScore(query, doc) {
  const q = keywords(query);
  if (!q.size) return 0;
  const d = keywords(doc);
  let hits = 0;
  for (const t of q) if (d.has(t)) hits++;
  return hits / q.size;
}


function recency(updatedAt, nowTs = Date.now()) {
  if (!updatedAt) return 0;
  const days = Math.max(0, (nowTs - updatedAt) / 86_400_000);
  return Math.pow(0.5, days / 14);
}




const STRONG_MARKERS = ['remember', 'important', 'always', 'never', 'my name', "i'm", 'i am', 'prefer', 'prefers', 'favorite', 'favourite', 'allergic', 'birthday', 'anniversary', 'my email', 'my phone', 'deadline', 'do not', "don't"];
const WEAK_MARKERS = ['maybe', 'probably', 'i think', 'perhaps', 'lol', 'haha', 'thanks', 'ok'];

function heuristicImportance(content, kind) {
  const text = String(content).toLowerCase();
  let score = kind === 'preference' ? 0.6 : kind === 'fact' || kind === 'semantic' ? 0.5 : kind === 'episodic' ? 0.35 : 0.45;
  for (const m of STRONG_MARKERS) if (text.includes(m)) score += 0.12;
  for (const m of WEAK_MARKERS) if (text.includes(m)) score -= 0.08;
  if (/\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) score += 0.05;
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) score += 0.08; 
  const words = text.split(/\s+/).length;
  if (words < 4) score -= 0.15;
  if (words > 12 && words < 60) score += 0.05;
  return Math.max(0.1, Math.min(1, Number(score.toFixed(2))));
}


const DUP_COS = 0.93;      
const UPDATE_COS = 0.82;   
const DUP_JAC = 0.8;
const UPDATE_JAC = 0.6;
const MIN_IMPORTANCE_TO_STORE = 0.25;

export function createMemoryService({ repos, gateway }) {
  async function embeddingModelFor(userId) {
    const setting = repos.users.getSetting(userId, 'embedding_model');
    if (!setting?.modelId) return null;
    return setting; 
  }

  async function embedTexts(userId, texts) {
    const em = await embeddingModelFor(userId);
    if (!em) return null;
    try {
      const vectors = await gateway.embed({ userId, modelRowId: em.modelId, input: texts });
      return vectors;
    } catch (err) {
      log.warn(`Embedding failed (${err.message}); falling back to lexical scoring`);
      return null;
    }
  }

  
  function similarity(aVec, bVec, aText, bText) {
    const cos = cosine(aVec, bVec);
    if (aVec && bVec && aVec.length && bVec.length) return cos;
    return jaccard(aText, bText);
  }

  
  async function remember({ userId, kind = 'fact', content, projectId = null, agentId = null, conversationId = null, source = null, importance = null, tags = null, subject = null, expiresAt = null }) {
    const trimmed = String(content || '').trim().slice(0, 4000);
    if (trimmed.length < 2) return { action: 'rejected', reason: 'empty' };

    const [vector] = (await embedTexts(userId, [trimmed])) || [];
    const computedImportance = importance != null ? Math.max(0, Math.min(1, Number(importance))) : heuristicImportance(trimmed, kind);

    const candidates = repos.memory.listForSearch(userId, { projectId, agentId });
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      if (c.kind === 'summary') continue; 
      const score = similarity(vector, c.embedding, trimmed, c.content);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    const dupAt = vector ? DUP_COS : DUP_JAC;
    const updateAt = vector ? UPDATE_COS : UPDATE_JAC;

    if (best && bestScore >= dupAt) {
      
      repos.memory.reinforce(best.id);
      return { action: 'reinforced', id: best.id, similarity: Number(bestScore.toFixed(3)) };
    }

    if (best && bestScore >= updateAt && best.kind === kind) {
      
      
      const id = randomId('mem');
      repos.memory.insert({
        id,
        userId,
        kind,
        content: trimmed,
        projectId,
        agentId,
        conversationId,
        embedding: vector || null,
        embeddingModel: vector ? 'configured' : null,
        source,
        importance: computedImportance,
        confidence: 0.85,
        tags,
        subject,
        expiresAt,
      });
      repos.memory.updateFields(userId, best.id, { supersededBy: id, status: 'superseded' });
      log.info(`memory updated (superseded ${best.id} → ${id}, sim=${bestScore.toFixed(2)})`);
      return { action: 'superseded', id, previousId: best.id, similarity: Number(bestScore.toFixed(3)) };
    }

    if (computedImportance < MIN_IMPORTANCE_TO_STORE) {
      return { action: 'rejected', reason: 'low importance', importance: computedImportance };
    }

    const id = randomId('mem');
    repos.memory.insert({
      id,
      userId,
      kind,
      content: trimmed,
      projectId,
      agentId,
      conversationId,
      embedding: vector || null,
      embeddingModel: vector ? 'configured' : null,
      source,
      importance: computedImportance,
      tags,
      subject,
      expiresAt,
    });
    return { action: 'stored', id, importance: computedImportance };
  }

  const service = {
    
    
    async add(opts) {
      const result = await remember(opts);
      return result.action === 'stored' || result.action === 'superseded' ? result.id : null;
    },

    remember,

    async update(userId, id, content) {
      const trimmed = String(content).trim().slice(0, 4000);
      const [vector] = (await embedTexts(userId, [trimmed])) || [];
      repos.memory.updateFields(userId, id, { content: trimmed, embedding: vector || undefined, embeddingModel: vector ? 'configured' : undefined });
    },

    delete: (userId, id) => repos.memory.delete(userId, id),

    list: (userId, opts) => repos.memory.list(userId, opts),

    stats: (userId) => repos.memory.stats(userId),

    async semanticSearch(userId, query, { limit = 8, projectId = null, agentId = null, reinforce = false } = {}) {
      const rows = repos.memory.listForSearch(userId, { projectId, agentId });
      const [queryVec] = (await embedTexts(userId, [query])) || [];
      const nowTs = Date.now();

      
      
      const scored = rows.map((r) => {
        const semantic = queryVec && r.embedding?.length ? cosine(queryVec, r.embedding) : jaccard(query, r.content);
        const kw = keywordScore(query, r.content);
        const similarity = Math.max(semantic, kw * 0.85);
        const score =
          similarity * 0.55 +
          recency(r.updatedAt, nowTs) * 0.16 +
          (r.importance ?? 0.5) * 0.2 +
          Math.min(1, Math.log10(1 + (r.accessCount || 0)) / Math.log10(1 + 20)) * 0.09;
        return { ...r, similarity: Number(similarity.toFixed(4)), score };
      });

      const results = scored
        .filter((r) => r.similarity > 0.12 || r.importance > 0.7)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (reinforce) {
        for (const r of results) repos.memory.reinforce(r.id);
      }
      return results;
    },

    
    
    
    async contextBlock(userId, { projectId = null, agentId = null, query = null, conversationId = null, limit = 10 } = {}) {
      let effectiveQuery = query || '';
      if (conversationId) {
        const recent = repos.chat
          .listMessages(conversationId, { limit: 24 })
          .filter((m) => m.role === 'user' && m.content)
          .slice(-3)
          .map((m) => m.content.slice(0, 300));
        if (recent.length) effectiveQuery = [...recent, effectiveQuery].filter(Boolean).join('\n');
      }
      let entries;
      if (effectiveQuery.trim()) {
        entries = await this.semanticSearch(userId, effectiveQuery, { limit, projectId, agentId, reinforce: true });
      } else {
        entries = repos.memory
          .list(userId, { projectId, agentId, limit })
          .sort((a, b) => b.importance * 0.7 + recency(b.updatedAt) * 0.3 - (a.importance * 0.7 + recency(a.updatedAt) * 0.3))
          .slice(0, limit);
      }
      entries = entries.slice(0, limit).map((e) => ({ kind: e.kind, content: e.content, importance: e.importance }));
      if (!entries.length) return '';
      const lines = entries.map((e) => `- (${e.kind}) ${e.content}`);
      return `Relevant memories about this user and their work (recall — may be partial):\n${lines.join('\n')}`;
    },

    
    
    async consolidate(userId) {
      const rows = repos.memory.listForSearch(userId);
      const vectors = await embedTexts(userId, rows.map((r) => r.content));
      const nowTs = Date.now();
      let merged = 0;
      let pruned = 0;
      let strengthened = 0;

      for (let i = 0; i < rows.length; i++) {
        const a = rows[i];
        if (a.status !== 'active') continue;
        for (let k = i + 1; k < rows.length; k++) {
          const b = rows[k];
          if (b.status !== 'active' || b.kind !== a.kind) continue;
          const sim = similarity(vectors?.[i], b.embedding, a.content, b.content);
          if (sim >= (vectors ? 0.93 : 0.85)) {
            
            const keep = (b.content.length > a.content.length ? 1 : 0) + (b.updatedAt > a.updatedAt ? 0.5 : 0);
            const [winner, loser] = keep >= 0.75 ? [b, a] : [a, b];
            repos.memory.updateFields(userId, loser.id, { supersededBy: winner.id, status: 'superseded' });
            repos.memory.reinforce(winner.id);
            loser.status = 'superseded';
            merged++;
          }
        }
      }

      for (const r of rows) {
        if (r.status !== 'active') continue;
        if (r.expiresAt && r.expiresAt < nowTs) {
          repos.memory.updateFields(userId, r.id, { status: 'expired' });
          pruned++;
          continue;
        }
        
        const lastTouch = Math.max(r.updatedAt || 0, r.lastAccessedAt || 0);
        if ((r.importance ?? 0.5) < 0.28 && nowTs - lastTouch > 30 * 86_400_000) {
          repos.memory.updateFields(userId, r.id, { status: 'expired' });
          pruned++;
          continue;
        }
        
        if ((r.accessCount || 0) >= 3 && (r.importance ?? 0) < 0.95) {
          repos.memory.updateFields(userId, r.id, { importance: Math.min(1, (r.importance ?? 0.5) + 0.03) });
          strengthened++;
        }
      }

      const result = { merged, pruned, strengthened, remaining: repos.memory.count(userId) };
      if (merged || pruned || strengthened) log.info(`consolidation for ${userId}: ${JSON.stringify(result)}`);
      return result;
    },

    
    
    
    async extractFromConversation({ userId, conversationId, modelRowId }) {
      const messages = repos.chat.listMessages(conversationId, { limit: 60 });
      const usable = messages.filter((m) => ['user', 'assistant'].includes(m.role) && m.content?.trim());
      if (usable.length < 4) return { extracted: 0 };

      const transcript = usable
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 1500)}`)
        .join('\n')
        .slice(0, 24_000);

      const prompt = [
        {
          role: 'system',
          content:
            'You extract durable memories about the user from a conversation. Return ONLY a JSON array (no markdown) of objects:\n' +
            '[{"content":"standalone fact in 3rd person, max 25 words","kind":"semantic|preference|episodic","importance":0.0-1.0,"reason":"why this is worth keeping"}]\n' +
            'Rules: semantic = durable facts about the user/work; preference = how they like things done; episodic = notable events with context. ' +
            'Only include information that stays useful in FUTURE conversations (identity, goals, preferences, decisions, project context). ' +
            'Skip transient chat, small talk, and anything already obvious. importance >= 0.6 only for clearly durable items. Return [] if nothing qualifies.',
        },
        { role: 'user', content: transcript },
      ];

      const { text } = await gateway.complete({ userId, modelRowId, messages: prompt, timeoutMs: 90_000 });
      let candidates = [];
      try {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) candidates = JSON.parse(match[0]);
      } catch {
        return { extracted: 0 };
      }
      if (!Array.isArray(candidates)) return { extracted: 0 };

      let added = 0;
      let superseded = 0;
      let rejected = 0;
      for (const c of candidates.slice(0, 12)) {
        const content = typeof c === 'string' ? c : c?.content;
        if (typeof content !== 'string' || content.trim().length < 8) continue;
        const kind = ['semantic', 'preference', 'episodic', 'fact', 'project'].includes(c?.kind) ? c.kind : 'semantic';
        const importance = typeof c?.importance === 'number' ? c.importance : null;
        const result = await this.remember({
          userId,
          kind,
          content: content.trim(),
          conversationId,
          source: 'auto-extract',
          importance,
        });
        if (result.action === 'stored') added++;
        else if (result.action === 'superseded') superseded++;
        else rejected++;
      }
      log.info(`Memory extraction for conv ${conversationId}: ${added} stored, ${superseded} updated, ${rejected} rejected`);
      return { extracted: added, superseded, rejected };
    },

    maxContentChars: 4000,
    limits: config.limits,
  };

  return service;
}
