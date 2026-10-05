import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const CMC_URL = process.env.CMC_MCP_URL || 'https://mcp.coinmarketcap.com/mcp';
const API_KEY = process.env.CMC_MCP_API_KEY;
const TIMEOUT_MS = Number(process.env.CMC_TIMEOUT_MS || 20000);
// The public CMC MCP currently behaves like a ~10 tool-call/minute service on the free tier.
// Stay one call below that observed ceiling so snapshots do not burst into 1008 errors.
const MAX_PER_MINUTE = Math.max(1, Number(process.env.CMC_MAX_CALLS_PER_MINUTE || 9));

if (!API_KEY) {
  throw new Error('CMC_MCP_API_KEY is required. Put it in the deployment environment, never in source code.');
}

const timestamps = [];

async function rateLimit() {
  while (true) {
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] >= 60_000) timestamps.shift();
    if (timestamps.length < MAX_PER_MINUTE) {
      timestamps.push(now);
      return;
    }
    const sleepMs = Math.max(50, 60_000 - (now - timestamps[0]) + 20);
    await new Promise(resolve => setTimeout(resolve, sleepMs));
  }
}

async function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Upstream CMC call timed out after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let upstreamClientPromise = null;

async function createConnectedClient() {
  const client = new Client(
    { name: 'cmc-gateway-upstream', version: '0.3.2' },
    { versionNegotiation: { mode: 'auto' } }
  );

  const transport = new StreamableHTTPClientTransport(new URL(CMC_URL), {
    requestInit: {
      headers: {
        'X-CMC-MCP-API-KEY': API_KEY
      }
    }
  });

  await withTimeout(client.connect(transport));
  // Discover once per upstream session instead of once per tool call.
  await withTimeout(client.listTools());
  return client;
}

async function getClient() {
  if (!upstreamClientPromise) {
    upstreamClientPromise = createConnectedClient().catch(error => {
      upstreamClientPromise = null;
      throw error;
    });
  }
  return upstreamClientPromise;
}

async function resetClient() {
  if (!upstreamClientPromise) return;
  try {
    const client = await upstreamClientPromise;
    await client.close().catch(() => {});
  } catch {}
  upstreamClientPromise = null;
}

export async function listUpstreamTools() {
  await rateLimit();
  const client = await getClient();
  try {
    return await withTimeout(client.listTools());
  } catch (error) {
    await resetClient();
    throw error;
  }
}

export async function callCmcTool(name, args = {}) {
  await rateLimit();
  let client = await getClient();
  try {
    return await withTimeout(client.callTool({ name, arguments: args }));
  } catch (error) {
    // Reconnect once for transport/session failures. Do not blindly retry a
    // successful MCP error response (for example an upstream rate-limit body).
    await resetClient();
    client = await getClient();
    return await withTimeout(client.callTool({ name, arguments: args }));
  }
}

export function compactToolResult(result) {
  const out = {
    isError: Boolean(result?.isError)
  };
  if (result?.structuredContent !== undefined) out.structuredContent = result.structuredContent;
  if (Array.isArray(result?.content)) {
    out.content = result.content.map(block => {
      if (block?.type === 'text') return { type: 'text', text: block.text };
      return block;
    });
  }
  return out;
}

export function extractFirstCmcId(result) {
  const candidates = [];

  const visit = value => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object') {
      if ('id' in value && (typeof value.id === 'number' || /^\d+$/.test(String(value.id)))) {
        candidates.push(String(value.id));
      }
      for (const v of Object.values(value)) visit(v);
      return;
    }
    if (typeof value === 'string') {
      try {
        visit(JSON.parse(value));
      } catch {
        const m = value.match(/\b(?:cmc\s*)?id["'\s:=#-]*(\d{1,12})\b/i);
        if (m) candidates.push(m[1]);
      }
    }
  };

  visit(result?.structuredContent);
  visit(result?.content);
  return candidates[0] || null;
}
