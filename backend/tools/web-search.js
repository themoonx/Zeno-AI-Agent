






import { config } from '../core/config.js';
import { assertSafeUrl } from './ssrf.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};
const TIMEOUT_MS = 15_000;

function timeoutSignal(signal) {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function withRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
}

async function tavilySearch(query, { maxResults, signal }) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: config.tavilyKey, query, max_results: maxResults }),
    signal: timeoutSignal(signal),
  });
  if (!res.ok) throw new Error(`Tavily returned ${res.status}`);
  const data = await res.json();
  return {
    source: 'tavily',
    results: (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 400) || '' })),
  };
}

async function braveSearch(query, { maxResults, signal }) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': config.braveKey, Accept: 'application/json' },
    signal: timeoutSignal(signal),
  });
  if (!res.ok) throw new Error(`Brave returned ${res.status}`);
  const data = await res.json();
  return {
    source: 'brave',
    results: (data.web?.results || []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: (r.description || '').replace(/<[^>]+>/g, '').slice(0, 400),
    })),
  };
}




async function ddgFetch(url, { method = 'GET', body, signal }) {
  const res = await fetch(url, {
    method,
    headers: BASE_HEADERS,
    body,
    signal: timeoutSignal(signal),
  });
  if (res.status === 403 || res.status === 429) throw new Error(`DuckDuckGo returned ${res.status} (rate limited)`);
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  
  if (/anomaly|captcha|unusual traffic/i.test(html.slice(0, 2000)) && !/result__a|result-link/i.test(html)) {
    throw new Error('DuckDuckGo served a bot-check page');
  }
  return html;
}

async function duckDuckGoSearch(query, { maxResults, signal }) {
  const strategies = [
    
    async () => {
      const url = new URL('https://html.duckduckgo.com/html/');
      url.searchParams.set('q', query);
      return ddgFetch(url, { signal });
    },
    
    async () => {
      const body = new URLSearchParams({ q: query, b: '' });
      return ddgFetch(new URL('https://html.duckduckgo.com/html/'), { method: 'POST', body: body.toString(), signal });
    },
    
    async () => {
      const url = new URL('https://lite.duckduckgo.com/lite/');
      url.searchParams.set('q', query);
      return ddgFetch(url, { signal });
    },
  ];

  const errorsSeen = [];
  for (const strategy of strategies) {
    try {
      const html = await strategy();
      const results = parseDdgHtml(html, maxResults);
      if (results.length) return { source: 'duckduckgo', results };
      errorsSeen.push('no results parsed');
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      errorsSeen.push(err.message);
    }
  }
  throw new Error(`DuckDuckGo failed (${errorsSeen.join('; ')})`);
}



const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function classList(attrs) {
  const c = attrValue(attrs, 'class');
  return c ? c.toLowerCase().split(/\s+/) : [];
}

export function parseDdgHtml(html, maxResults) {
  const results = [];
  let match;
  ANCHOR_RE.lastIndex = 0;
  while ((match = ANCHOR_RE.exec(html)) && results.length < maxResults) {
    const [full, attrs, inner] = match;
    const classes = classList(attrs);
    const isHtmlResult = classes.includes('result__a');
    const isLiteResult = classes.includes('result-link');
    if (!isHtmlResult && !isLiteResult) continue;

    let href = attrValue(attrs, 'href') || '';
    
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        href = uddg[1];
      }
    }
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\
    if (/duckduckgo\.com\/y\.js/i.test(href)) continue; 
    if (/duckduckgo\.com\/l\/\?$/i.test(href)) continue; 

    const title = stripTags(inner);
    if (!title) continue;

    
    
    
    
    const rest = html.slice(match.index + full.length, match.index + full.length + 3000);
    const nextResult = rest.search(/<a\b[^>]*class\s*=\s*["'][^"']*\b(result__a|result-link)\b/i);
    const window = nextResult === -1 ? rest : rest.slice(0, nextResult);
    const snippetMatch = window.match(/class\s*=\s*["']?[^"'>]*(result__snippet|result-snippet)[^>]*>([\s\S]*?)<\/(a|td|div|span)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[2]) : '';

    results.push({ title, url: href, snippet });
  }
  return results;
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const webSearchTool = {
  name: 'web_search',
  displayName: 'Web Search',
  description:
    'Search the public web. Returns a list of results with title, URL and snippet. Use before claiming current facts.',
  sensitive: false,
  permissionClass: 'net.read',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      max_results: { type: 'integer', description: 'Max results to return (1-10)', default: 5 },
    },
    required: ['query'],
  },

  async execute(args, { signal } = {}) {
    const query = String(args.query || '').slice(0, 400);
    if (!query.trim()) throw new Error('query is required');
    const maxResults = Math.min(10, Math.max(1, Number(args.max_results) || 5));

    const attempts = [];
    if (config.tavilyKey) attempts.push(['tavily', () => tavilySearch(query, { maxResults, signal })]);
    if (config.braveKey) attempts.push(['brave', () => braveSearch(query, { maxResults, signal })]);
    attempts.push(['duckduckgo', () => withRetry(() => duckDuckGoSearch(query, { maxResults, signal }), 2)]);

    const errorsSeen = [];
    for (const [name, fn] of attempts) {
      try {
        const out = await fn();
        return { ok: true, query, provider: out.source, results: out.results };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        errorsSeen.push(`${name}: ${err.message}`);
      }
    }
    throw new Error(`All search providers failed — ${errorsSeen.join('; ')}`);
  },

  async checkUrl(url) {
    return assertSafeUrl(url);
  },
};
