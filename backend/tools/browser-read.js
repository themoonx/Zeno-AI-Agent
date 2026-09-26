



import { assertSafeUrl } from './ssrf.js';
import { extractReadableText, extractTitle, extractLinks } from './html.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ZenoAI/1.0';

export const browserReadTool = {
  name: 'browser_read',
  displayName: 'Browser (read)',
  description:
    'Open a URL and read the page as clean text. Use for reading articles, docs, or pages found via web_search. Returns title, text, and optionally on-page links.',
  sensitive: false,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to open' },
      include_links: { type: 'boolean', description: 'Also return on-page links', default: false },
      max_chars: { type: 'integer', description: 'Max characters of text (up to 30000)', default: 12000 },
    },
    required: ['url'],
  },

  async execute(args, { signal }) {
    const url = await assertSafeUrl(String(args.url || ''));
    const maxChars = Math.min(30_000, Math.max(500, Number(args.max_chars) || 12_000));

    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: signal || AbortSignal.timeout(30_000),
    });
    const finalUrl = res.url || url.toString();
    if (!res.ok) {
      return { ok: false, url: finalUrl, status: res.status, error: `Page returned HTTP ${res.status}` };
    }
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();

    if (contentType.includes('application/json') || (!contentType.includes('html') && !body.trimStart().startsWith('<'))) {
      const text = body.slice(0, maxChars);
      return { ok: true, url: finalUrl, status: res.status, contentType, title: null, text };
    }

    const title = extractTitle(body);
    const text = extractReadableText(body, { maxChars });
    const links = args.include_links ? extractLinks(body, finalUrl, { maxLinks: 30 }) : undefined;
    return { ok: true, url: finalUrl, status: res.status, contentType, title, text, links };
  },
};
