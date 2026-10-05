process.env.NODE_ENV = 'development';
process.env.PUBLIC_BASE_URL = 'https://cmc-gateway-test.example.com';
process.env.OAUTH_LOGIN_SECRET = 'this-is-only-a-self-test-secret';
process.env.OAUTH_SIGNING_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { createOAuthConfig, verifyAccessToken, _test } = await import('../src/oauth.mjs');
const cfg = createOAuthConfig();
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const clientId = _test.makeClientId({ redirect_uris: [redirect], client_name: 'Self Test' }, cfg);
const client = _test.readClientId(clientId, cfg);
if (!client.redirect_uris.includes(redirect)) throw new Error('Client redirect validation failed');

const verifier = 'self-test-verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
const challenge = _test.sha256Base64Url(verifier);
const code = _test.makeAuthorizationCode({
  client_id: clientId,
  redirect_uri: redirect,
  code_challenge: challenge,
  resource: cfg.resource,
  scope: cfg.scope
}, cfg);
const decodedCode = _test.verifyCompact(code, cfg.signingSecret);
if (decodedCode.code_challenge !== challenge) throw new Error('Authorization code challenge binding failed');

const access = _test.makeAccessToken({ clientId, resource: cfg.resource, scope: cfg.scope }, cfg);
const claims = verifyAccessToken(access, cfg);
if (claims.aud !== cfg.resource || claims.scope !== cfg.scope) throw new Error('Access token verification failed');

console.log('OAuth self-test passed');
console.log(JSON.stringify({ issuer: cfg.issuer, resource: cfg.resource, redirect_uri: redirect, scope: cfg.scope }, null, 2));
