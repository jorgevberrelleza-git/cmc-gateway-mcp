import { callCmcTool, compactToolResult, extractFirstCmcId } from './cmc-client.mjs';

async function pass(tool, args = {}) {
  return compactToolResult(await callCmcTool(tool, args));
}

export async function buildMarketReport() {
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

  return {
    generated_at: new Date().toISOString(),
    ...Object.fromEntries(entries)
  };
}

export async function buildAssetResearch(query, newsLimit = 5) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) throw new Error('asset query is required');

  const search = await callCmcTool('search_cryptos', { query: cleanQuery });
  const id = extractFirstCmcId(search);
  if (!id) throw new Error(`Could not resolve a numeric CoinMarketCap ID for "${cleanQuery}"`);

  const jobs = {
    search: Promise.resolve(compactToolResult(search)),
    quote: pass('get_crypto_quotes_latest', { id }),
    info: pass('get_crypto_info', { id }),
    holders: pass('get_crypto_metrics', { id }),
    technicals: pass('get_crypto_technical_analysis', { id }),
    news: pass('get_crypto_latest_news', { id, limit: newsLimit })
  };

  const settled = await Promise.all(
    Object.entries(jobs).map(async ([key, p]) => {
      try {
        return [key, await p];
      } catch (error) {
        return [key, { isError: true, error: error?.message || String(error) }];
      }
    })
  );

  return {
    generated_at: new Date().toISOString(),
    query: cleanQuery,
    cmc_id: id,
    ...Object.fromEntries(settled)
  };
}

export async function buildTradingSnapshot({ assets = ['BTC', 'AAVE', 'ADA'], newsLimit = 4 } = {}) {
  const cleanAssets = [...new Set(
    (Array.isArray(assets) ? assets : [])
      .map(x => String(x || '').trim().toUpperCase())
      .filter(Boolean)
  )];

  if (cleanAssets.length < 1) throw new Error('At least one asset is required');
  if (cleanAssets.length > 3) throw new Error('v0.3 supports up to 3 assets per snapshot to protect API credits and latency');

  const safeNewsLimit = Math.min(5, Math.max(1, Number(newsLimit) || 4));

  const [market, assetEntries] = await Promise.all([
    buildMarketReport(),
    Promise.all(cleanAssets.map(async asset => {
      try {
        return [asset, await buildAssetResearch(asset, safeNewsLimit)];
      } catch (error) {
        return [asset, { isError: true, error: error?.message || String(error) }];
      }
    }))
  ]);

  return {
    snapshot_version: '0.3.0',
    generated_at: new Date().toISOString(),
    provider: 'CoinMarketCap MCP via private CMC Gateway',
    mode: 'read_only_decision_support',
    execution_enabled: false,
    assets: cleanAssets,
    news_limit_per_asset: safeNewsLimit,
    market,
    asset_research: Object.fromEntries(assetEntries),
    usage_note: 'Use this as structured market evidence. Validate material catalysts with primary/authoritative sources before changing a real-money position.'
  };
}
