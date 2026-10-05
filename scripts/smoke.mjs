import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.env.GATEWAY_URL || 'http://127.0.0.1:8787/mcp';
const token = process.env.GATEWAY_BEARER_TOKEN || '';
const headers = token ? { Authorization: `Bearer ${token}` } : {};

const client = new Client(
  { name: 'cmc-gateway-smoke', version: '0.1.0' },
  { versionNegotiation: { mode: 'auto' } }
);
const transport = new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers } });

await client.connect(transport);
const { tools } = await client.listTools();
console.log('Tools:', tools.map(t => t.name).join(', '));

if (process.env.RUN_LIVE_CMC === 'true') {
  const result = await client.callTool({ name: 'get_crypto_quotes_latest', arguments: { id: '1' } });
  console.log(JSON.stringify(result, null, 2));
}

await client.close();
