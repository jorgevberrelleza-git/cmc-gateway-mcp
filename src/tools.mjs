import * as z from 'zod/v4';
import { callCmcTool, compactToolResult, extractFirstCmcId, listUpstreamTools } from './cmc-client.mjs';

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

function registerProxy(server, name, description, inputSchema, mapArgs = x => x) {
  server.registerTool(name, { description, inputSchema }, async input => {
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
    {
      description: 'Diagnostic tool: list the exact tools and JSON schemas currently advertised by the upstream CoinMarketCap MCP server. Useful when CMC changes an input schema.',
      inputSchema: z.object({}).strict()
    },
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
    {
      description: 'Read-only escape hatch for calling one of the 12 allow-listed CoinMarketCap MCP tools with its exact upstream argument object. Use only if a wrapper schema is stale.',
      inputSchema: z.object({
        tool_name: z.string(),
        arguments: z.record(z.string(), z.unknown()).default({})
      })
    },
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
    {
      description: 'Composite trading-context snapshot built from CoinMarketCap global metrics, market technicals, derivatives, narratives, upcoming events, and BTC/ETH quotes. Read-only.',
      inputSchema: z.object({}).strict()
    },
    async () => {
      const jobs = {
        global: ['get_global_metrics_latest', {}],
        technicals: ['get_crypto_marketcap_technical_analysis', {}],
        derivatives: ['get_global_crypto_derivatives_metrics', {}],
        narratives: ['trending_crypto_narratives', {}],
        events: ['get_upcoming_macro_events', {}],
        btc_eth: ['get_crypto_quotes_latest', { id: '1,1027' }]
      };

      const entries = await Promise.all(
        Object.entries(jobs).map(async ([key, [tool, args]]) => {
          try {
            return [key, await pass(tool, args)];
          } catch (error) {
            return [key, { isError: true, error: error?.message || String(error) }];
          }
        })
      );
      return resultAsText({ generated_at: new Date().toISOString(), ...Object.fromEntries(entries) });
    }
  );

  server.registerTool(
    'asset_research',
    {
      description: 'Composite CoinMarketCap due-diligence snapshot for one asset: identity, quote, project info, holder metrics, technical analysis and recent news. It resolves the CMC ID automatically.',
      inputSchema: z.object({
        query: z.string().min(1).max(120),
        news_limit: z.number().int().min(1).max(10).default(5)
      })
    },
    async ({ query, news_limit }) => {
      try {
        const search = await callCmcTool('search_cryptos', { query });
        const id = extractFirstCmcId(search);
        if (!id) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Could not resolve a numeric CoinMarketCap ID for "${query}". Use search_cryptos and inspect the result.` }]
          };
        }

        const jobs = {
          search: Promise.resolve(compactToolResult(search)),
          quote: pass('get_crypto_quotes_latest', { id }),
          info: pass('get_crypto_info', { id }),
          holders: pass('get_crypto_metrics', { id }),
          technicals: pass('get_crypto_technical_analysis', { id }),
          news: pass('get_crypto_latest_news', { id, limit: news_limit })
        };

        const settled = await Promise.all(
          Object.entries(jobs).map(async ([key, p]) => {
            try { return [key, await p]; }
            catch (error) { return [key, { isError: true, error: error?.message || String(error) }]; }
          })
        );

        return resultAsText({
          generated_at: new Date().toISOString(),
          query,
          cmc_id: id,
          ...Object.fromEntries(settled)
        });
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `asset_research failed: ${error?.message || String(error)}` }] };
      }
    }
  );
}
