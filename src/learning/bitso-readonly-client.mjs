// Bitso READ-ONLY client. Signed GET requests to an explicit allowlist only.
// There is deliberately no code path for POST/DELETE or order endpoints.
// Auth (Bitso docs): HMAC-SHA256(secret, nonce + method + requestPath + body),
// header "Authorization: Bitso <key>:<nonce>:<signature>".
import crypto from 'node:crypto';

const ALLOWED_PATHS = Object.freeze(['/api/v3/balance/', '/api/v3/fees/']);

export function signBitso({ key, secret, nonce, method, path, body = '' }) {
  const signature = crypto.createHmac('sha256', secret).update(String(nonce) + method + path + body).digest('hex');
  return `Bitso ${key}:${nonce}:${signature}`;
}

export function makeBitsoReadOnlyClient({ key, secret, baseUrl = 'https://api.bitso.com', fetchImpl = fetch, timeoutMs = 8000 }) {
  if (!key || !secret) throw new Error('bitso_readonly:credentials_missing');
  let lastNonce = 0;
  async function get(path) {
    if (!ALLOWED_PATHS.includes(path)) throw new Error('bitso_readonly:path_not_allowed:' + path);
    const nonce = Math.max(Date.now(), lastNonce + 1); lastNonce = nonce;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, { method: 'GET', signal: ctl.signal,
        headers: { Authorization: signBitso({ key, secret, nonce, method: 'GET', path }) } });
      const j = await res.json();
      if (!res.ok || j.success !== true) throw new Error('bitso_readonly:' + (j?.error?.code || res.status));
      return j.payload;
    } finally { clearTimeout(timer); }
  }
  return {
    async balances() {
      const p = await get('/api/v3/balance/');
      return Object.fromEntries((p.balances || []).map(b => [String(b.currency).toLowerCase(),
        { available: Number(b.available), locked: Number(b.locked), total: Number(b.total) }]));
    }
  };
}
