import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const CMC_URL = process.env.CMC_MCP_URL || 'https://mcp.coinmarketcap.com/mcp';
const API_KEY = process.env.CMC_MCP_API_KEY;
const TIMEOUT_MS = Number(process.env.CMC_TIMEOUT_MS || 20000);
// The public CMC MCP currently behaves like a ~10 tool-call/minute service on the free tier.
// Stay one call below that observed ceiling so snapshots do not burst into 1008 errors.
const MAX_PER_MINUTE = Math.max(1, Number(process.env.CMC_MAX_CALLS_PER_MINUTE || 9));
// Legacy handshake skips SDK v2 server/discover probe. Keep auto available
// for servers that support the new MCP protocol, with rollback via environment.
export function cmcMcpProtocolMode(env = process.env) {
  return String(env.CMC_MCP_PROTOCOL_MODE || 'auto').trim().toLowerCase()==='legacy' ? 'legacy' : 'auto';
}

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

// Record the failing MCP protocol stage without ever logging API credentials,
// request headers, upstream response bodies or exception messages.
function tagMcpError(error,phase) {
  if(error&&typeof error==='object'&&!error.cmc_stage){
    try{Object.defineProperty(error,'cmc_stage',{value:phase,enumerable:false});}catch{}
  }
  return error;
}
async function mcpStage(phase,fn){
  try{return await fn();}
  catch(error){throw tagMcpError(error,phase);}
}

let upstreamClientPromise = null;

async function createConnectedClient() {
  const client = new Client(
    { name: 'cmc-gateway-upstream', version: '0.3.2' },
    { versionNegotiation: { mode: cmcMcpProtocolMode() } }
  );

  const transport = new StreamableHTTPClientTransport(new URL(CMC_URL), {
    requestInit: {
      headers: {
        'X-CMC-MCP-API-KEY': API_KEY
      }
    }
  });

  try {
    await mcpStage('initialize',()=>withTimeout(client.connect(transport)));
    // Discover only once per upstream session; distinguish this step from
    // authentication/initialization failures without persisting raw messages.
    await mcpStage('list_tools',()=>withTimeout(client.listTools()));
    return client;
  } catch(error){
    await client.close().catch(()=>{});
    throw error;
  }
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
    return await mcpStage('list_tools',()=>withTimeout(client.listTools()));
  } catch (error) {
    await resetClient();
    throw error;
  }
}

export async function callCmcTool(name, args = {}) {
  await rateLimit();
  let client = await getClient();
  try {
    return await mcpStage('call_tool',()=>withTimeout(client.callTool({ name, arguments: args })));
  } catch (error) {
    // MCP tool errors can throw (rather than returning isError); retrying
    // quota/auth/schema failures immediately makes quota pressure worse.
    const m=String(error?.message||'').toLowerCase();
    const nonRetryable=/429|1008|rate.limit|quota|401|403|auth|forbidden|unknown tool|not found|invalid.argument|validation|schema|entitlement/.test(m);
    const transient=/timeout|timed out|econnreset|econnrefused|socket|transport|session|network|fetch failed|disconnected/.test(m);
    if(nonRetryable || !transient) throw error;
    await resetClient();
    await rateLimit(); // reconnect is a second upstream call, not a free attempt.
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
