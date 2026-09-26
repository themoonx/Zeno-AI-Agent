

const BASE = '/api';
let sessionToken = null;
let onUnauthorized = () => {};

export function setToken(token) {
  sessionToken = token;
}
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function headers(extra = {}) {
  const h = { ...extra };
  if (sessionToken) h.Authorization = `Bearer ${sessionToken}`;
  return h;
}

async function handle(res) {
  if (res.status === 401) {
    onUnauthorized();
    const err = new Error('Not signed in');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = 'error';
    let details;
    try {
      const body = await res.json();
      message = body?.error?.message || message;
      code = body?.error?.code || code;
      details = body?.error?.details;
    } catch {
      
    }
    const err = new Error(message);
    err.status = res.status;
    err.code = code;
    err.details = details;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path),

  upload: async (path, files, params = {}) => {
    const fd = new FormData();
    for (const file of files) fd.append('files', file, file.name);
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(BASE + path + (qs ? `?${qs}` : ''), {
      method: 'POST',
      headers: headers(),
      body: fd,
    });
    return handle(res);
  },

  fileUrl: (fileId) => `${BASE}/files/${fileId}/download`,

  
  
  
  sse(path, onEvent, { signal } = {}) {
    const controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    (async () => {
      try {
        const res = await fetch(BASE + path, {
          headers: headers({ Accept: 'text/event-stream' }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue; 
            try {
              onEvent(JSON.parse(dataLine.slice(5).trim()));
            } catch {
              
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') onEvent({ type: 'stream_error', message: err.message });
      }
    })();
    return () => controller.abort();
  },

  
  chatStream(payload, onEvent, { signal } = {}) {
    const controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    (async () => {
      try {
        const res = await fetch(BASE + '/chat/stream', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = `Chat failed (${res.status})`;
          try {
            const body = await res.json();
            message = body?.error?.message || message;
          } catch {  }
          throw new Error(message);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              onEvent(JSON.parse(dataLine.slice(5).trim()));
            } catch {  }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') onEvent({ type: 'aborted' });
        else onEvent({ type: 'stream_error', message: err.message });
      }
    })();
    return () => controller.abort();
  },
};
