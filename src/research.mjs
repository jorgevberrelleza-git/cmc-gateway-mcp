import { callCmcTool, compactToolResult, extractFirstCmcId } from './cmc-client.mjs';

async function pass(tool, args = {}) {
  return compactToolResult(await callCmcTool(tool, args));
}

const KNOWN_IDS = new Map([
  ['BTC', '1'],
  ['ETH', '1027'],
  ['ADA', '2010'],
  ['AAVE', '7278']
]);

async function resolveId(query) {
  const clean = String(query || '').trim();
  const known = KNOWN_IDS.get(clean.toUpperCase());
  if (known) return { id: known, search: null, source: 'known_id' };

  const search = await callCmcTool('search_cryptos', { query: clean });
  const id = extractFirstCmcId(search);
  if (!id) throw new Error(`Could not resolve a numeric CoinMarketCap ID for "${clean}"`);
  return { id, search: compactToolResult(search), source: 'search' };
}

export async function buildMarketReport() {
  const jobs = {
    global: ['get_global_metrics_latest', {}],
    technicals: ['get_crypto_marketcap_technical_analysis', {}],
    derivatives: ['get_global_crypto_derivatives_metrics', {}],
    narratives: ['trending_crypto_narratives', {}],
    events: ['get_upcoming_macro_events', {}]
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

  return {
    generated_at: new Date().toISOString(),
    ...Object.fromEntries(entries)
  };
}

export async function buildAssetResearch(query, newsLimit = 5) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('asset query is required');

  const resolved = await resolveId(cleanQuery);
  const id = resolved.id;
  const safeNewsLimit = Math.min(10, Math.max(1, Number(newsLimit) || 5));

  // Deep research is intentionally separate from the core trading snapshot.
  // The gateway's local limiter will pace these calls to stay below CMC's
  // observed free-tier MCP ceiling.
  const jobs = {
    quote: ['get_crypto_quotes_latest', { id }],
    info: ['get_crypto_info', { id }],
    holders: ['get_crypto_metrics', { id }],
    technicals: ['get_crypto_technical_analysis', { id }],
    news: ['get_crypto_latest_news', { id, limit: safeNewsLimit }]
  };

  const entries = [];
  for (const [key, [tool, args]] of Object.entries(jobs)) {
    try {
      entries.push([key, await pass(tool, args)]);
    } catch (error) {
      entries.push([key, { isError: true, error: error?.message || String(error) }]);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    query: cleanQuery,
    cmc_id: id,
    id_source: resolved.source,
    search: resolved.search,
    ...Object.fromEntries(entries)
  };
}

export async function buildTradingSnapshot({ assets = ['BTC', 'AAVE', 'ADA'] } = {}) {
  const cleanAssets = [...new Set(
    (Array.isArray(assets) ? assets : [])
      .map(x => String(x || '').trim().toUpperCase())
      .filter(Boolean)
  )];

  if (cleanAssets.length < 1) throw new Error('At least one asset is required');
  if (cleanAssets.length > 3) throw new Error('v0.3.2 supports up to 3 assets per core snapshot');

  const resolved = {};
  for (const asset of cleanAssets) {
    resolved[asset] = await resolveId(asset);
  }

  // CORE SNAPSHOT BUDGET (BTC/AAVE/ADA):
  //   market context = 5 calls
  //   batched quotes (assets + ETH benchmark) = 1 call
  //   technicals = 1 call per asset (max 3)
  // Total = max 9 CMC tool calls, deliberately below the observed 10/minute ceiling.
  const market = await buildMarketReport();

  const quoteIds = [...new Set(['1027', ...cleanAssets.map(a => resolved[a].id)])].join(',');
  let quotes;
  try {
    quotes = await pass('get_crypto_quotes_latest', { id: quoteIds });
  } catch (error) {
    quotes = { isError: true, error: error?.message || String(error) };
  }

  const technicalEntries = [];
  for (const asset of cleanAssets) {
    try {
      technicalEntries.push([asset, await pass('get_crypto_technical_analysis', { id: resolved[asset].id })]);
    } catch (error) {
      technicalEntries.push([asset, { isError: true, error: error?.message || String(error) }]);
    }
  }

  return {
    snapshot_version: '0.3.2',
    generated_at: new Date().toISOString(),
    provider: 'CoinMarketCap MCP via private CMC Gateway',
    mode: 'read_only_decision_support',
    execution_enabled: false,
    snapshot_depth: 'core',
    assets: cleanAssets,
    cmc_ids: Object.fromEntries(cleanAssets.map(a => [a, resolved[a].id])),
    market,
    quotes,
    asset_technicals: Object.fromEntries(technicalEntries),
    deep_research_note: 'Holder metrics, project info and per-asset news are intentionally fetched only on demand via asset_research so the free-tier MCP rate limit is not exhausted before technical data arrives.',
    usage_note: 'Use this as structured market evidence. Validate material catalysts with primary/authoritative sources before changing a real-money position.'
  };
}
