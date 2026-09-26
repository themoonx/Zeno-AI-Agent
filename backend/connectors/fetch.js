

import { assertPublicHttpUrl } from './guard.js';

const MAX_REDIRECTS = 3;

export async function requestViaPublicInternet(rawUrl, { method = 'GET', headers = {}, body = null, signal = undefined } = {}) {
  let url = await assertPublicHttpUrl(String(rawUrl));
  let currentUrl = url;
  let response;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetch(currentUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const location = response.headers.get('location');
      let next;
      try {
        next = new URL(location, currentUrl);
      } catch {
        throw new Error(`Invalid redirect target: ${location}`);
      }
      if (next.username || next.password) {
        throw new Error('Redirects with credentials are not allowed');
      }
      if (['301', '302', '303'].includes(String(response.status)) && method === 'POST') method = 'GET';
      currentUrl = await assertPublicHttpUrl(next.href);
      try {
        await response.body?.cancel();
      } catch {
        
      }
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects (limit ${MAX_REDIRECTS})`);
}
