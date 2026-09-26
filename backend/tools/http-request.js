
import { assertSafeUrl } from './ssrf.js';

export const httpRequestTool = {
  name: 'http_request',
  displayName: 'HTTP Request',
  description:
    'Make an HTTP request to an API endpoint and get the response. Methods: GET/POST/PUT/PATCH/DELETE. Public internet only.',
  sensitive: true, 
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
      headers: { type: 'object', description: 'Request headers (values must be strings)' },
      body: { type: 'string', description: 'Request body (raw string, e.g. JSON)' },
      max_chars: { type: 'integer', description: 'Max response characters (up to 30000)', default: 12000 },
    },
    required: ['url'],
  },

  async execute(args, { signal }) {
    const url = await assertSafeUrl(String(args.url || ''));
    const method = String(args.method || 'GET').toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(args.headers || {})) headers[k] = String(v);
    if (args.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    const maxChars = Math.min(30_000, Math.max(500, Number(args.max_chars) || 12_000));

    const res = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : args.body,
      redirect: 'follow',
      signal: signal || AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      url: res.url,
      headers: Object.fromEntries([...res.headers.entries()].slice(0, 30)),
      body: parsed !== null ? parsed : text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  },
};
