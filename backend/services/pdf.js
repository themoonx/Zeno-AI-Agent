


import zlib from 'node:zlib';

export function extractPdfText(buf, { maxChars = 60_000 } = {}) {
  try {
    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (raw.slice(0, 5).toString() !== '%PDF-') return null;

    
    const chunks = [];
    const streamRe = /stream\r?\n?/g;
    let m;
    while ((m = streamRe.exec(raw))) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      if (end === -1) continue;
      const slice = raw.slice(start, end);
      let text;
      try {
        text = zlib.inflateSync(slice).toString('latin1');
      } catch {
        text = slice.toString('latin1');
      }
      if (text.includes('Tj') || text.includes('TJ')) chunks.push(text);
      streamRe.lastIndex = end;
    }
    if (!chunks.length) return null;

    
    const out = [];
    for (const content of chunks) {
      const tokenRe = /\((?:\\.|[^\\()])*\)|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bET\b/g;
      let tok;
      let line = '';
      while ((tok = tokenRe.exec(content))) {
        const t = tok[0];
        if (t.startsWith('(')) {
          line += decodePdfString(t.slice(1, -1));
        } else if (t === 'Td' || t === 'TD' || t === 'T*' || t === 'ET') {
          if (line.trim()) out.push(line.trim());
          line = '';
        }
      }
      if (line.trim()) out.push(line.trim());
    }

    let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text || text.length < 8) return null;
    if (text.length > maxChars) text = text.slice(0, maxChars) + '\n[truncated]';
    return text;
  } catch {
    return null;
  }
}

function decodePdfString(s) {
  return s
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1');
}
