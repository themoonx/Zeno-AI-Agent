
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (msg, details) => new AppError(400, 'bad_request', msg, details),
  unauthorized: (msg = 'Authentication required') => new AppError(401, 'unauthorized', msg),
  forbidden: (msg = 'Not allowed') => new AppError(403, 'forbidden', msg),
  notFound: (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`),
  conflict: (msg) => new AppError(409, 'conflict', msg),
  gone: (msg) => new AppError(410, 'gone', msg),
  payloadTooLarge: (msg) => new AppError(413, 'payload_too_large', msg),
  rateLimited: (msg = 'Too many requests, slow down') => new AppError(429, 'rate_limited', msg),
  upstream: (msg, details) => new AppError(502, 'upstream_error', msg, details),
  internal: (msg = 'Internal server error') => new AppError(500, 'internal', msg),
};


export function upstreamFromResponse(providerName, status, bodyText) {
  let detail = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.message || parsed?.error || bodyText;
  } catch {
    
  }
  if (typeof detail !== 'string') detail = JSON.stringify(detail);
  const trimmed = detail.slice(0, 600);
  const friendly =
    status === 401 || status === 403
      ? `Provider rejected the API key (${providerName}). Check the credential in Settings → Providers.`
      : status === 404
        ? `Model or endpoint not found on ${providerName}. Verify the base URL and model ID.`
        : status === 429
          ? `${providerName} rate limit hit. Retry shortly.`
          : `${providerName} returned ${status}`;
  return new AppError(status >= 500 ? 502 : 400, 'provider_error', `${friendly}: ${trimmed}`, {
    provider: providerName,
    upstreamStatus: status,
  });
}
