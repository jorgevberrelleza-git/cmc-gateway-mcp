import http from 'node:http';
import crypto from 'node:crypto';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { registerCmcTools } from './tools.mjs';
import { handleSnapshotHttp } from './snapshot.mjs';
import {
  createOAuthConfig,
  handleOAuthHttp,
  protectedResourceMetadata,
  verifyAccessToken
} from './oauth.mjs';

const PORT = Number(process.env.PORT || 8787);
const GATEWAY_TOKEN = process.env.GATEWAY_BEARER_TOKEN || '';
const ALLOW_LEGACY_BEARER = String(process.env.ALLOW_LEGACY_BEARER || 'false').toLowerCase() === 'true';
const oauth = createOAuthConfig();

function makeServer() {
  const server = new McpServer(
    { name: 'cmc-gateway', version: '0.3.2' },
    {
      capabilities: { tools: {} },
      instructions: 'Read-only CoinMarketCap gateway. Never places trades or performs exchange writes. Prefer market_report for broad market context and asset_research for one-token due diligence.'
    }
  );
  registerCmcTools(server);
  return server;
}

const mcpHandler = createMcpHandler(() => makeServer());
const nodeMcpHandler = toNodeHandler(mcpHandler);

function timingSafeEqualString(a, b) {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function challengeHeaders(error = 'invalid_token', description = 'OAuth login is required to access this MCP server.') {
  const metadataUrl = `${oauth.baseUrl}/.well-known/oauth-protected-resource`;
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'www-authenticate': `Bearer resource_metadata="${metadataUrl}", scope="${oauth.scope}", error="${error}", error_description="${description.replaceAll('"', "'")}"`
  };
}

function authenticate(req) {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearer) return { ok: false, reason: 'missing_token' };

  try {
    const claims = verifyAccessToken(bearer, oauth);
    return { ok: true, mode: 'oauth', claims };
  } catch (error) {
    if (ALLOW_LEGACY_BEARER && GATEWAY_TOKEN && timingSafeEqualString(bearer, GATEWAY_TOKEN)) {
      return { ok: true, mode: 'legacy_bearer', claims: { sub: 'legacy-owner', scope: oauth.scope } };
    }
    return { ok: false, reason: error?.message || 'invalid_token' };
  }
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', oauth.baseUrl);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      service: 'cmc-gateway-mcp',
      version: '0.3.2',
      oauth: true,
      issuer: oauth.issuer,
      resource: oauth.resource,
      time: new Date().toISOString()
    }));
    return;
  }

  if (await handleSnapshotHttp(req, res, url)) return;

  if (await handleOAuthHttp(req, res, url, oauth)) return;

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const auth = authenticate(req);
  if (!auth.ok) {
    res.writeHead(401, challengeHeaders('invalid_token', 'Connect this gateway with OAuth before using CoinMarketCap tools.'));
    res.end(JSON.stringify({
      error: 'unauthorized',
      resource_metadata: `${oauth.baseUrl}/.well-known/oauth-protected-resource`
    }));
    return;
  }

  try {
    await nodeMcpHandler(req, res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'gateway_error', message: error?.message || String(error) }));
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.error(`CMC Gateway MCP v0.3.2 listening on http://0.0.0.0:${PORT}/mcp`);
  console.error(`Public OAuth issuer: ${oauth.issuer}`);
  console.error(`Protected resource: ${oauth.resource}`);
  console.error(`Health check: http://0.0.0.0:${PORT}/healthz`);
  console.error(`Snapshot console: ${oauth.baseUrl}/snapshot`);
  console.error('Inbound auth: OAuth 2.1 authorization code + PKCE (S256)');
  console.error(`Legacy bearer: ${ALLOW_LEGACY_BEARER ? 'enabled' : 'disabled'}`);
});
