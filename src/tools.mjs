import * as z from 'zod/v4';
import { callCmcTool, compactToolResult, listUpstreamTools } from './cmc-client.mjs';
import { buildAssetResearch, buildMarketReport } from './research.mjs';

const OFFICIAL_TOOLS = new Set([
  'search_cryptos',
  'get_crypto_quotes_latest',
  'get_crypto_info',
  'get_crypto_metrics',
  'get_crypto_technical_analysis',
  'get_crypto_latest_news',
  'search_crypto_info',
  'get_global_metrics_latest',
  'get_global_crypto_derivatives_metrics',
  'get_crypto_marketcap_technical_analysis',
  'trending_crypto_narratives',
  'get_upcoming_macro_events'
]);

const pass = async (tool, args = {}) => compactToolResult(await callCmcTool(tool, args));

function resultAsText(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

const READ_ONLY_SECURITY = [{ type: 'oauth2', scopes: ['cmc:read'] }];
const READ_ONLY_META = { securitySchemes: READ_ONLY_SECURITY };
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

function securedConfig(config) {
  return {
    ...config,
    securitySchemes: READ_ONLY_SECURITY,
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: { ...(config?._meta || {}), ...READ_ONLY_META }
  };
}

function registerProxy(server, name, description, inputSchema, mapArgs = x => x) {
  server.registerTool(name, securedConfig({ description, inputSchema }), async input => {
    try {
      return resultAsText(await pass(name, mapArgs(input)));
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${name} failed: ${error?.message || String(error)}` }]
      };
    }
  });
}

export function registerCmcTools(server) {
  registerProxy(
    server,
    'search_cryptos',
    'Search CoinMarketCap cryptocurrencies by name, symbol, or slug. Use this first for asset-specific analysis to resolve a numeric CMC ID.',
    z.object({ query: z.string().min(1).max(120) })
  );

  registerProxy(
    server,
    'get_crypto_quotes_latest',
    'Get current CoinMarketCap quote data for one or more numeric CMC IDs. Supports batching with comma-separated IDs such as "1,1027".',
    z.object({ id: z.string().regex(/^\d+(,\d+)*$/) })
  );

  registerProxy(
    server,
    'get_crypto_info',
    'Get static project metadata, links, description, tags, launch information and official resources for a numeric CMC ID.',
    z.object({ id: z.string().regex(/^\d+(,\d+)*$/) })
  );

  registerProxy(
    server,
    'get_crypto_metrics',
    'Get CoinMarketCap holder/on-chain distribution metrics for a cryptocurrency identified by numeric CMC ID.',
    z.object({ id: z.string().regex(/^\d+$/) })
  );

  registerProxy(
    server,
    'get_crypto_technical_analysis',
    'Get CoinMarketCap technical analysis for a cryptocurrency: moving averages, RSI, MACD, Fibonacci and pivot/support-resistance data.',
    z.object({ id: z.string().regex(/^\d+$/) })
  );

  registerProxy(
    server,
    'get_crypto_latest_news',
    'Get recent CoinMarketCap news for a cryptocurrency. Resolve the numeric CMC ID first.',
    z.object({
      id: z.string().regex(/^\d+$/),
      limit: z.number().int().min(1).max(20).optional()
    }),
    ({ id, limit }) => (limit == null ? { id } : { id, limit })
  );

  registerProxy(
    server,
    'search_crypto_info',
    'Semantic search across CoinMarketCap crypto knowledge, project information, concepts, FAQs and related content.',
    z.object({ query: z.string().min(2).max(500) })
  );

  registerProxy(
    server,
    'get_global_metrics_latest',
    'Get global crypto market metrics including total market cap, volume, BTC/ETH dominance, Fear & Greed, Altcoin Season and ETF-flow context when available.',
    z.object({}).strict()
  );

  registerProxy(
    server,
    'get_global_crypto_derivatives_metrics',
    'Get global crypto derivatives metrics including open interest, funding, liquidations and futures/perpetual positioning.',
    z.object({}).strict()
  );

  registerProxy(
    server,
    'get_crypto_marketcap_technical_analysis',
    'Get technical analysis for the overall crypto market capitalization, including RSI, MACD and key levels.',
    z.object({}).strict()
  );

  registerProxy(
    server,
    'trending_crypto_narratives',
    'Get CoinMarketCap trending crypto narratives, themes/sectors, performance and associated leading assets.',
    z.object({}).strict()
  );

  registerProxy(
    server,
    'get_upcoming_macro_events',
    'Get upcoming market-moving macro, regulatory and protocol events tracked by CoinMarketCap.',
    z.object({}).strict()
  );

  server.registerTool(
    'cmc_list_upstream_tools',
    securedConfig({
      description: 'Diagnostic tool: list the exact tools and JSON schemas currently advertised by the upstream CoinMarketCap MCP server. Useful when CMC changes an input schema.',
      inputSchema: z.object({}).strict()
    }),
    async () => {
      try {
        const { tools } = await listUpstreamTools();
        const safe = tools.map(({ name, description, inputSchema, outputSchema }) => ({ name, description, inputSchema, outputSchema }));
        return resultAsText(safe);
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Tool discovery failed: ${error?.message || String(error)}` }] };
      }
    }
  );

  server.registerTool(
    'cmc_raw_call',
    securedConfig({
      description: 'Read-only escape hatch for calling one of the 12 allow-listed CoinMarketCap MCP tools with its exact upstream argument object. Use only if a wrapper schema is stale.',
      inputSchema: z.object({
        tool_name: z.string(),
        arguments: z.record(z.string(), z.unknown()).default({})
      })
    }),
    async ({ tool_name, arguments: args }) => {
      if (!OFFICIAL_TOOLS.has(tool_name)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Blocked tool: ${tool_name}. Only official read-only CMC tools are allowed.` }]
        };
      }
      try {
        return resultAsText(await pass(tool_name, args));
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `Raw CMC call failed: ${error?.message || String(error)}` }] };
      }
    }
  );

  server.registerTool(
    'market_report',
    securedConfig({
      description: 'Composite trading-context snapshot built from CoinMarketCap global metrics, market technicals, derivatives, narratives, upcoming events, and BTC/ETH quotes. Read-only.',
      inputSchema: z.object({}).strict()
    }),
    async () => {
      try {
        return resultAsText(await buildMarketReport());
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `market_report failed: ${error?.message || String(error)}` }] };
      }
    }
  );

  server.registerTool(
    'asset_research',
    securedConfig({
      description: 'Composite CoinMarketCap due-diligence snapshot for one asset: identity, quote, project info, holder metrics, technical analysis and recent news. It resolves the CMC ID automatically.',
      inputSchema: z.object({
        query: z.string().min(1).max(120),
        news_limit: z.number().int().min(1).max(10).default(5)
      })
    }),
    async ({ query, news_limit }) => {
      try {
        return resultAsText(await buildAssetResearch(query, news_limit));
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `asset_research failed: ${error?.message || String(error)}` }] };
      }
    }
  );
}
