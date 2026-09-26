

export function extractReadableText(html, { maxChars = 20_000 } = {}) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|iframe|head)[\s\S]*?<\/\1>/gi, ' ');
  
  s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' [image: $1] ');
  // Mark headings and block ends so text has some structure.
  s = s.replace(/<\/(h1|h2|h3|h4|p|li|tr|div|section|article|blockquote|pre)>/gi, '\n');
  s = s.replace(/<br[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return ' ';
      }
    });
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n\s*\n\s*\n+/g, '\n\n');
  s = s
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n\n[truncated]';
  return s;
}

export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim();
}

export function extractLinks(html, baseUrl, { maxLinks = 40 } = {}) {
  const links = [];
  const re = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const base = new URL(baseUrl);
  while ((m = re.exec(html)) && links.length < maxLinks) {
    try {
      const url = new URL(m[1], base);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (url.host !== base.host) continue; 
      const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (links.some((l) => l.url === url.toString())) continue;
      links.push({ url: url.toString(), text: text.slice(0, 120) });
    } catch {
      
    }
  }
  return links;
}
