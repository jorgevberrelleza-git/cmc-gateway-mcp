import crypto from 'node:crypto';

const textEncoder = new TextEncoder();

function b64urlEncode(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return buf.toString('base64url');
}

function b64urlDecode(value) {
  return Buffer.from(value, 'base64url');
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function resolvePublicBaseUrl() {
  const raw = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  const normalized = normalizeBaseUrl(raw);
  if (normalized) return normalized;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('PUBLIC_BASE_URL or RENDER_EXTERNAL_URL is required in production for OAuth issuer discovery.');
  }
  return `http://127.0.0.1:${Number(process.env.PORT || 8787)}`;
}

export function createOAuthConfig() {
  const baseUrl = resolvePublicBaseUrl();
  const resource = `${baseUrl}/mcp`;
  const loginSecret = process.env.OAUTH_LOGIN_SECRET || '';
  const signingSecret = process.env.OAUTH_SIGNING_SECRET || process.env.GATEWAY_BEARER_TOKEN || '';
  const allowedHosts = new Set(
    String(process.env.OAUTH_ALLOWED_REDIRECT_HOSTS || 'chatgpt.com,openai.com')
      .split(',')
      .map(x => x.trim().toLowerCase())
      .filter(Boolean)
  );
  const accessTtl = Number(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS || 3600);
  const refreshTtl = Number(process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS || 2592000);
  const codeTtl = Number(process.env.OAUTH_CODE_TTL_SECONDS || 300);

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    if (!loginSecret || loginSecret.length < 16) {
      throw new Error('OAUTH_LOGIN_SECRET is required in production and must be at least 16 characters.');
    }
    if (!signingSecret || signingSecret.length < 32) {
      throw new Error('OAUTH_SIGNING_SECRET (or GATEWAY_BEARER_TOKEN fallback) must be at least 32 characters.');
    }
  }

  return {
    baseUrl,
    issuer: baseUrl,
    resource,
    loginSecret,
    signingSecret,
    allowedHosts,
    accessTtl,
    refreshTtl,
    codeTtl,
    scope: 'cmc:read'
  };
}

function signCompact(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT', kid: 'cmc-gateway-oauth-v1' };
  const encodedHeader = b64urlEncode(header);
  const encodedPayload = b64urlEncode(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${hmac(secret, signingInput)}`;
}

function verifyCompact(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  const [encodedHeader, encodedPayload, signature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = hmac(secret, signingInput);
  if (!timingSafeEqualString(signature, expected)) throw new Error('invalid_signature');
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new Error('invalid_payload');
  }
  const now = nowSeconds();
  if (payload.exp && now >= Number(payload.exp)) throw new Error('token_expired');
  if (payload.nbf && now < Number(payload.nbf)) throw new Error('token_not_active');
  return payload;
}

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeScopes(scopeValue, requiredScope) {
  const requested = new Set(String(scopeValue || requiredScope).split(/\s+/).filter(Boolean));
  if (!requested.has(requiredScope)) requested.add(requiredScope);
  return [...requested].filter(s => s === requiredScope || s === 'offline_access').join(' ');
}

function hostAllowed(hostname, allowedHosts) {
  const host = String(hostname || '').toLowerCase();
  for (const allowed of allowedHosts) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function validateRedirectUri(uri, allowedHosts) {
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error('invalid_redirect_uri'); }
  if (parsed.protocol !== 'https:') throw new Error('redirect_uri_must_use_https');
  if (!hostAllowed(parsed.hostname, allowedHosts)) throw new Error('redirect_uri_host_not_allowed');
  return parsed.toString();
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function makeClientId(registration, cfg) {
  const payload = {
    typ: 'client',
    iss: cfg.issuer,
    iat: nowSeconds(),
    exp: nowSeconds() + 31536000,
    jti: randomId(12),
    redirect_uris: registration.redirect_uris,
    client_name: registration.client_name || 'ChatGPT MCP Client',
    token_endpoint_auth_method: 'none'
  };
  return signCompact(payload, cfg.signingSecret);
}

function readClientId(clientId, cfg) {
  const payload = verifyCompact(clientId, cfg.signingSecret);
  if (payload.typ !== 'client' || payload.iss !== cfg.issuer) throw new Error('invalid_client');
  return payload;
}

function makeRequestToken(params, cfg) {
  return signCompact({
    typ: 'auth_request',
    iss: cfg.issuer,
    iat: nowSeconds(),
    exp: nowSeconds() + 600,
    jti: randomId(12),
    ...params
  }, cfg.signingSecret);
}

function makeAuthorizationCode(params, cfg) {
  return signCompact({
    typ: 'authorization_code',
    iss: cfg.issuer,
    iat: nowSeconds(),
    exp: nowSeconds() + cfg.codeTtl,
    jti: randomId(18),
    sub: 'owner',
    ...params
  }, cfg.signingSecret);
}

function makeAccessToken({ clientId, resource, scope }, cfg) {
  const issuedAt = nowSeconds();
  return signCompact({
    typ: 'access_token',
    iss: cfg.issuer,
    sub: 'owner',
    aud: resource,
    client_id: clientId,
    scope,
    iat: issuedAt,
    exp: issuedAt + cfg.accessTtl,
    jti: randomId(18)
  }, cfg.signingSecret);
}

function makeRefreshToken({ clientId, resource, scope }, cfg) {
  const issuedAt = nowSeconds();
  return signCompact({
    typ: 'refresh_token',
    iss: cfg.issuer,
    sub: 'owner',
    aud: resource,
    client_id: clientId,
    scope,
    iat: issuedAt,
    exp: issuedAt + cfg.refreshTtl,
    jti: randomId(18)
  }, cfg.signingSecret);
}

export function verifyAccessToken(token, cfg) {
  const payload = verifyCompact(token, cfg.signingSecret);
  if (payload.typ !== 'access_token') throw new Error('wrong_token_type');
  if (payload.iss !== cfg.issuer) throw new Error('invalid_issuer');
  if (payload.aud !== cfg.resource) throw new Error('invalid_audience');
  const scopes = new Set(String(payload.scope || '').split(/\s+/).filter(Boolean));
  if (!scopes.has(cfg.scope)) throw new Error('insufficient_scope');
  return payload;
}

export function protectedResourceMetadata(cfg) {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: [cfg.scope],
    resource_documentation: `${cfg.baseUrl}/oauth/info`
  };
}

export function authorizationServerMetadata(cfg) {
  return {
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.baseUrl}/oauth/authorize`,
    token_endpoint: `${cfg.baseUrl}/oauth/token`,
    registration_endpoint: `${cfg.baseUrl}/oauth/register`,
    revocation_endpoint: `${cfg.baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [cfg.scope],
    authorization_response_iss_parameter_supported: true
  };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    pragma: 'no-cache',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    pragma: 'no-cache',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function readBody(req, maxBytes = 65536) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function redirectWithParams(res, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  res.writeHead(302, { location: url.toString(), 'cache-control': 'no-store' });
  res.end();
}

function renderLogin({ requestToken, clientName, scope, error = '' }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize CMC Gateway</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;margin:0;padding:40px;color:#15171a}.card{max-width:520px;margin:8vh auto;background:#fff;border:1px solid #ddd;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.06)}h1{font-size:22px;margin:0 0 12px}p{line-height:1.5}.scope{background:#f2f4f7;border-radius:10px;padding:12px;margin:16px 0}.error{color:#b42318;background:#fef3f2;padding:10px;border-radius:8px;margin:12px 0}input[type=password]{width:100%;box-sizing:border-box;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin:8px 0 16px}.actions{display:flex;gap:10px}button{padding:11px 16px;border-radius:9px;border:1px solid #222;font-weight:600;cursor:pointer}.approve{background:#111;color:#fff}.deny{background:#fff;color:#111}.small{font-size:13px;color:#666}</style></head>
<body><main class="card"><h1>Authorize CMC Gateway</h1>
<p><strong>${escapeHtml(clientName)}</strong> is requesting read-only access to CoinMarketCap market data through your private gateway.</p>
<div class="scope"><strong>Permission:</strong> ${escapeHtml(scope)}<br><span class="small">No Bitso trading, withdrawals, or write actions are available.</span></div>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="request_token" value="${escapeHtml(requestToken)}">
<label for="secret">Gateway login secret</label><input id="secret" name="login_secret" type="password" autocomplete="current-password" required autofocus>
<div class="actions"><button class="approve" name="decision" value="approve" type="submit">Approve</button><button class="deny" name="decision" value="deny" type="submit">Cancel</button></div>
</form><p class="small">This secret is validated only by your gateway and is not sent to CoinMarketCap.</p></main></body></html>`;
}

const failedAuth = new Map();
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
function recordFailure(ip) {
  const now = Date.now();
  const arr = (failedAuth.get(ip) || []).filter(t => now - t < 10 * 60_000);
  arr.push(now);
  failedAuth.set(ip, arr);
  return arr.length;
}
function tooManyFailures(ip) {
  const now = Date.now();
  const arr = (failedAuth.get(ip) || []).filter(t => now - t < 10 * 60_000);
  if (arr.length) failedAuth.set(ip, arr); else failedAuth.delete(ip);
  return arr.length >= 8;
}
function clearFailures(ip) { failedAuth.delete(ip); }

const usedCodes = new Map();
function markCodeUsed(jti, exp) {
  const now = nowSeconds();
  for (const [key, expires] of usedCodes.entries()) if (expires <= now) usedCodes.delete(key);
  if (usedCodes.has(jti)) return false;
  usedCodes.set(jti, Number(exp || now + 300));
  return true;
}

export async function handleOAuthHttp(req, res, url, cfg) {
  if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
    json(res, 200, protectedResourceMetadata(cfg));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
    json(res, 200, authorizationServerMetadata(cfg));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/oauth/info') {
    json(res, 200, {
      service: 'CMC Gateway MCP',
      version: '0.2.0',
      resource: cfg.resource,
      scope: cfg.scope,
      authorization: 'OAuth 2.1 authorization code + PKCE (S256)',
      client_registration: 'Dynamic Client Registration (stateless signed client IDs)',
      write_actions: false
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/register') {
    try {
      const body = await readBody(req);
      const input = JSON.parse(body || '{}');
      if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 10) {
        json(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
        return true;
      }
      const redirectUris = [...new Set(input.redirect_uris.map(uri => validateRedirectUri(uri, cfg.allowedHosts)))];
      if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') {
        json(res, 400, { error: 'invalid_client_metadata', error_description: 'Only public PKCE clients are supported' });
        return true;
      }
      const registration = {
        redirect_uris: redirectUris,
        client_name: String(input.client_name || 'ChatGPT MCP Client').slice(0, 120)
      };
      const clientId = makeClientId(registration, cfg);
      json(res, 201, {
        client_id: clientId,
        client_id_issued_at: nowSeconds(),
        redirect_uris: redirectUris,
        client_name: registration.client_name,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      });
    } catch (error) {
      json(res, 400, { error: 'invalid_client_metadata', error_description: error?.message || String(error) });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    const params = Object.fromEntries(url.searchParams.entries());
    let client;
    try {
      if (params.response_type !== 'code') throw new Error('unsupported_response_type');
      client = readClientId(params.client_id, cfg);
      const redirectUri = validateRedirectUri(params.redirect_uri, cfg.allowedHosts);
      if (!client.redirect_uris.includes(redirectUri)) throw new Error('redirect_uri_mismatch');
      if (!params.code_challenge || params.code_challenge_method !== 'S256') throw new Error('pkce_s256_required');
      const resource = params.resource || cfg.resource;
      if (resource !== cfg.resource) throw new Error('invalid_resource');
      const scope = normalizeScopes(params.scope, cfg.scope);
      const requestToken = makeRequestToken({
        client_id: params.client_id,
        redirect_uri: redirectUri,
        state: params.state || '',
        code_challenge: params.code_challenge,
        code_challenge_method: 'S256',
        resource,
        scope,
        client_name: client.client_name || 'ChatGPT MCP Client'
      }, cfg);
      html(res, 200, renderLogin({ requestToken, clientName: client.client_name || 'ChatGPT MCP Client', scope }));
    } catch (error) {
      if (params.redirect_uri) {
        try {
          const redirectUri = validateRedirectUri(params.redirect_uri, cfg.allowedHosts);
          redirectWithParams(res, redirectUri, {
            error: 'invalid_request',
            error_description: error?.message || String(error),
            state: params.state || '',
            iss: cfg.issuer
          });
          return true;
        } catch {}
      }
      json(res, 400, { error: 'invalid_request', error_description: error?.message || String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/authorize') {
    const ip = clientIp(req);
    try {
      const form = parseForm(await readBody(req));
      const requestPayload = verifyCompact(form.request_token, cfg.signingSecret);
      if (requestPayload.typ !== 'auth_request' || requestPayload.iss !== cfg.issuer) throw new Error('invalid_authorization_request');

      if (form.decision === 'deny') {
        redirectWithParams(res, requestPayload.redirect_uri, {
          error: 'access_denied',
          error_description: 'The user denied access',
          state: requestPayload.state || '',
          iss: cfg.issuer
        });
        return true;
      }

      if (tooManyFailures(ip)) {
        html(res, 429, renderLogin({ requestToken: form.request_token, clientName: requestPayload.client_name, scope: requestPayload.scope, error: 'Too many failed attempts. Try again later.' }));
        return true;
      }

      if (!timingSafeEqualString(form.login_secret, cfg.loginSecret)) {
        recordFailure(ip);
        html(res, 401, renderLogin({ requestToken: form.request_token, clientName: requestPayload.client_name, scope: requestPayload.scope, error: 'Incorrect gateway login secret.' }));
        return true;
      }
      clearFailures(ip);

      const code = makeAuthorizationCode({
        client_id: requestPayload.client_id,
        redirect_uri: requestPayload.redirect_uri,
        code_challenge: requestPayload.code_challenge,
        resource: requestPayload.resource,
        scope: requestPayload.scope
      }, cfg);
      redirectWithParams(res, requestPayload.redirect_uri, {
        code,
        state: requestPayload.state || '',
        iss: cfg.issuer
      });
    } catch (error) {
      json(res, 400, { error: 'invalid_request', error_description: error?.message || String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    try {
      const form = parseForm(await readBody(req));
      const grantType = form.grant_type;

      if (grantType === 'authorization_code') {
        const code = verifyCompact(form.code, cfg.signingSecret);
        if (code.typ !== 'authorization_code' || code.iss !== cfg.issuer) throw new Error('invalid_grant');
        if (!markCodeUsed(code.jti, code.exp)) throw new Error('authorization_code_already_used');
        if (form.client_id !== code.client_id) throw new Error('client_id_mismatch');
        if (form.redirect_uri !== code.redirect_uri) throw new Error('redirect_uri_mismatch');
        if (!form.code_verifier) throw new Error('missing_code_verifier');
        if (!timingSafeEqualString(sha256Base64Url(form.code_verifier), code.code_challenge)) throw new Error('pkce_verification_failed');
        if (form.resource && form.resource !== code.resource) throw new Error('invalid_resource');

        const accessToken = makeAccessToken({ clientId: code.client_id, resource: code.resource, scope: code.scope }, cfg);
        const refreshToken = makeRefreshToken({ clientId: code.client_id, resource: code.resource, scope: code.scope }, cfg);
        json(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: cfg.accessTtl,
          refresh_token: refreshToken,
          scope: code.scope
        });
        return true;
      }

      if (grantType === 'refresh_token') {
        const refresh = verifyCompact(form.refresh_token, cfg.signingSecret);
        if (refresh.typ !== 'refresh_token' || refresh.iss !== cfg.issuer) throw new Error('invalid_grant');
        if (form.client_id && form.client_id !== refresh.client_id) throw new Error('client_id_mismatch');
        if (form.resource && form.resource !== refresh.aud) throw new Error('invalid_resource');
        const scope = normalizeScopes(form.scope || refresh.scope, cfg.scope);
        const accessToken = makeAccessToken({ clientId: refresh.client_id, resource: refresh.aud, scope }, cfg);
        const refreshToken = makeRefreshToken({ clientId: refresh.client_id, resource: refresh.aud, scope }, cfg);
        json(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: cfg.accessTtl,
          refresh_token: refreshToken,
          scope
        });
        return true;
      }

      json(res, 400, { error: 'unsupported_grant_type' });
    } catch (error) {
      json(res, 400, { error: 'invalid_grant', error_description: error?.message || String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
    // Tokens are short-lived, stateless HMAC tokens. Revocation is best-effort in v0.2;
    // rotating OAUTH_SIGNING_SECRET invalidates all outstanding tokens immediately.
    try { await readBody(req); } catch {}
    res.writeHead(200, { 'cache-control': 'no-store' });
    res.end();
    return true;
  }

  return false;
}

export const _test = {
  signCompact,
  verifyCompact,
  makeClientId,
  readClientId,
  makeAuthorizationCode,
  makeAccessToken,
  makeRefreshToken,
  normalizeScopes,
  validateRedirectUri,
  sha256Base64Url,
  timingSafeEqualString
};
