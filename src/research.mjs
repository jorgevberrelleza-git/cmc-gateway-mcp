import { callCmcTool, compactToolResult, extractFirstCmcId } from './cmc-client.mjs';
import { buildMicrostructureSnapshot } from './microstructure.mjs';

async function pass(tool, args = {}) {
  return compactToolResult(await callCmcTool(tool, args));
}


function parseCompactPayload(result) {
  if (result?.structuredContent != null) return result.structuredContent;
  for (const block of result?.content || []) {
    if (block?.type !== 'text') continue;
    try { return JSON.parse(block.text); } catch {}
  }
  return null;
}

function quoteRowsFromCompact(quotes) {
  const p = parseCompactPayload(quotes);
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.rows) && Array.isArray(p.headers)) {
    return p.rows.map(row => Object.fromEntries(p.headers.map((h, i) => [h, row[i]])));
  }
  return [];
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function r(v, d = 2) {
  return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d));
}

function buildRelativeStrength(quotes, assets) {
  const rows = quoteRowsFromCompact(quotes);
  const bySymbol = new Map(rows.map(x => [String(x?.symbol || '').toUpperCase(), x]));
  const horizons = [
    ['24h', 'percent_change_24h'],
    ['7d', 'percent_change_7d'],
    ['30d', 'percent_change_30d']
  ];
  const out = {};
  for (const asset of assets) {
    const q = bySymbol.get(asset);
    if (!q) { out[asset] = { available: false, reason: 'quote_missing' }; continue; }
    const benchmarks = {};
    for (const bench of ['BTC', 'ETH']) {
      const bq = bySymbol.get(bench);
      if (!bq || bench === asset) continue;
      const diffs = {};
      for (const [label, key] of horizons) {
        const av = n(q[key]), bv = n(bq[key]);
        diffs[label] = av == null || bv == null ? null : r(av - bv, 2);
      }
      const vals = Object.values(diffs).filter(x => x != null);
      const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      benchmarks[bench] = {
        excess_return_percentage_points: diffs,
        average_excess_return_pp: r(avg, 2),
        classification: avg == null ? 'unknown' : avg >= 2 ? 'clear_outperformance' : avg > 0 ? 'mild_outperformance' : avg <= -2 ? 'clear_underperformance' : 'mild_underperformance'
      };
    }
    out[asset] = { available: true, benchmarks };
  }
  return {
    methodology: 'Relative strength = asset percentage return minus benchmark percentage return over the same horizon. Positive values mean outperformance in percentage points; this is not a price ratio chart.',
    assets: out
  };
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

export async function buildTradingSnapshot({ assets = ['BTC', 'AAVE', 'ADA'], includeMicrostructure = true, captureMs } = {}) {
  const cleanAssets = [...new Set(
    (Array.isArray(assets) ? assets : [])
      .map(x => String(x || '').trim().toUpperCase())
      .filter(Boolean)
  )];

  if (cleanAssets.length < 1) throw new Error('At least one asset is required');
  if (cleanAssets.length > 3) throw new Error('v0.5 supports up to 3 assets per core snapshot');

  const resolved = {};
  for (const asset of cleanAssets) {
    resolved[asset] = await resolveId(asset);
  }

  // CMC CORE BUDGET (BTC/AAVE/ADA):
  //   market context = 5 calls
  //   batched quotes (assets + ETH benchmark) = 1 call
  //   technicals = 1 call per asset (max 3)
  // Total = max 9 CMC tool calls, deliberately below the observed free-tier ceiling.
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
  const assetTechnicals = Object.fromEntries(technicalEntries);
  const relativeStrength = buildRelativeStrength(quotes, cleanAssets);

  let microstructure = null;
  if (includeMicrostructure) {
    try {
      microstructure = await buildMicrostructureSnapshot({
        assets: cleanAssets,
        quotes,
        technicals: assetTechnicals,
        market,
        captureMs
      });
    } catch (error) {
      microstructure = {
        isError: true,
        error: error?.message || String(error),
        note: 'CMC core data is still valid. Do not infer manipulation from a failed Bitso microstructure capture.'
      };
    }
  }

  return {
    snapshot_version: '0.5.0',
    generated_at: new Date().toISOString(),
    providers: ['CoinMarketCap MCP via private CMC Gateway', 'Bitso public REST/WebSocket'],
    mode: 'read_only_decision_support',
    execution_enabled: false,
    snapshot_depth: includeMicrostructure ? 'core_plus_microstructure_v2' : 'core',
    assets: cleanAssets,
    cmc_ids: Object.fromEntries(cleanAssets.map(a => [a, resolved[a].id])),
    market,
    quotes,
    asset_technicals: assetTechnicals,
    relative_strength: relativeStrength,
    microstructure,
    guardrails: {
      no_manipulation_claim_without_evidence: true,
      high_trap_risk_requires_confirmation: true,
      high_crowding_requires_retest_or_spot_confirmation: true,
      venue_signal_is_execution_context_not_a_trade_command: true,
      low_microstructure_confidence_cannot_create_a_trade_signal: true,
      cancellation_metrics_require_matched_lifecycles: true
    },
    deep_research_note: 'Holder metrics, project info and per-asset news are intentionally fetched only on demand via asset_research so the free-tier CMC rate limit is preserved.',
    usage_note: 'Use CMC as structured market evidence and Bitso microstructure as execution-context evidence. v0.5 adds matched lifecycle cancellation logic, persistence, sweep/rejection heuristics, confidence scoring and explicit relative strength. Validate material catalysts with primary/authoritative sources before changing a real-money position.'
  };
}

