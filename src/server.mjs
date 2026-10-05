import http from 'node:http';
import crypto from 'node:crypto';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { registerCmcTools } from './tools.mjs';

const PORT = Number(process.env.PORT || 8787);
const GATEWAY_TOKEN = process.env.GATEWAY_BEARER_TOKEN || '';
const ALLOW_INSECURE = String(process.env.ALLOW_INSECURE || 'false').toLowerCase() === 'true';
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD && !GATEWAY_TOKEN && !ALLOW_INSECURE) {
  throw new Error('Refusing to start an unauthenticated public gateway. Set GATEWAY_BEARER_TOKEN or explicitly ALLOW_INSECURE=true.');
}

function makeServer() {
  const server = new McpServer(
    { name: 'cmc-gateway', version: '0.1.0' },
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

function isAuthorized(req) {
  if (!GATEWAY_TOKEN) return true;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const alt = String(req.headers['x-gateway-token'] || '');
  return timingSafeEqualString(bearer, GATEWAY_TOKEN) || timingSafeEqualString(alt, GATEWAY_TOKEN);
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, service: 'cmc-gateway-mcp', version: '0.1.0', time: new Date().toISOString() }));
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="cmc-gateway"'
    });
    res.end(JSON.stringify({ error: 'unauthorized' }));
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
  console.error(`CMC Gateway MCP listening on http://0.0.0.0:${PORT}/mcp`);
  console.error(`Health check: http://0.0.0.0:${PORT}/healthz`);
  console.error(`Inbound auth: ${GATEWAY_TOKEN ? 'Bearer token required' : 'disabled (local/private use only)'}`);
});
