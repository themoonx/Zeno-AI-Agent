


import net from 'node:net';
import dns from 'node:dns/promises';
import { AppError } from '../core/errors.js';

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  '169.254.169.254',
]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower === 'fe80::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return false;
}

export async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, 'bad_url', 'Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError(400, 'bad_url', 'Only http and https URLs are allowed');
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_HOSTNAMES.has(url.host)) {
    throw new AppError(400, 'blocked_url', 'This host is blocked for security reasons');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError(400, 'blocked_url', 'Local/internal hosts are not reachable from connectors');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new AppError(400, 'blocked_url', 'Private IP addresses are not reachable from connectors');
    }
    return url;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new AppError(400, 'dns_error', `Could not resolve host: ${host}`);
  }
  for (const { address } of records) {
    if (isPrivateIp(address)) {
      throw new AppError(400, 'blocked_url', 'Host resolves to a private address and is not reachable from connectors');
    }
  }
  return url;
}

export async function assertRedirectTargetSafe(rawUrl) {
  const url = await assertPublicHttpUrl(rawUrl);
  if (url.username || url.password) {
    throw new AppError(400, 'blocked_url', 'Credentials in redirect targets are not allowed');
  }
  return url;
}
