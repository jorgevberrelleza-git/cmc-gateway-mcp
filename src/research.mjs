import { callCmcTool, compactToolResult, extractFirstCmcId } from './cmc-client.mjs';
import { buildMicrostructureSnapshot } from './microstructure.mjs';
import { buildDefiFundamentalsForAssets } from './defi-fundamentals.mjs';
import { fetchCmcPublicQuotes, classifyCmcQuoteFailure } from './cmc-public-quotes.mjs';
import { fetchCoinPaprikaQuotes } from './coinpaprika-quotes.mjs';
import { extractLearningFeatures } from './learning/features.mjs';

async function pass(tool, args = {}) {
  return compactToolResult(await callCmcTool(tool, args));
}


function parseCompactPayload(result) {
  const structured = result?.structuredContent ?? null;
  let parsedText = null;
  for (const block of result?.content || []) {
    if (block?.type !== 'text') continue;
    try { parsedText = JSON.parse(block.text); break; } catch {}
  }
  if (structured != null && parsedText != null) {
    return { structuredContent: structured, content_json: parsedText };
  }
  if (structured != null) return structured;
  return parsedText;
}

function flattenQuoteAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const quoteRaw = asset.quote;
  let usd = null;
  if (Array.isArray(quoteRaw)) {
    usd = quoteRaw.find(q => String(q?.symbol || q?.convert_symbol || '').toUpperCase() === 'USD') || quoteRaw[0] || null;
  } else if (quoteRaw && typeof quoteRaw === 'object') {
    usd = quoteRaw.USD || quoteRaw.usd || Object.values(quoteRaw)[0] || null;
  }
  return {
    ...asset,
    ...(usd && typeof usd === 'object' ? usd : {}),
    symbol: asset.symbol ?? usd?.symbol ?? null,
    quote_symbol: usd?.symbol ?? null
  };
}

function normalizeQuoteRowsPayload(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p.map(flattenQuoteAsset).filter(Boolean);

  if (Array.isArray(p.rows) && Array.isArray(p.headers)) {
    return p.rows.map(row => Object.fromEntries(p.headers.map((h, i) => [h, row?.[i]])));
  }

  if (p.data != null) {
    const records = Array.isArray(p.data)
      ? p.data
      : (typeof p.data === 'object' ? Object.values(p.data) : []);
    const out = records.map(flattenQuoteAsset).filter(Boolean);
    if (out.length) return out;
  }

  if (p.result != null) return normalizeQuoteRowsPayload(p.result);
  if (p.symbol || p.quote) {
    const single = flattenQuoteAsset(p);
    return single ? [single] : [];
  }
  return [];
}
function quoteRowsFromCompact(quotes) {
  return normalizeQuoteRowsPayload(parseCompactPayload(quotes));
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
  if (cleanAssets.length > 3) throw new Error('v0.6.2 supports up to 3 assets per core snapshot');

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
  const cmcIds=Object.fromEntries(cleanAssets.map(a=>[a,resolved[a].id]));
  let quotes;
  const quoteProvenance={
    source:'cmc_mcp',
    mcp_failure_class:null,
    public_fallback_attempted:false,
    public_fallback_error_class:null,
    coinpaprika_fallback_attempted:false,
    coinpaprika_error_class:null,
    paid_ai_calls_made:0
  };
  try {
    quotes = await pass('get_crypto_quotes_latest', { id: quoteIds });
    if(quotes?.isError){
      const msg=quotes?.content?.filter(x=>x?.type==='text').map(x=>x.text).join(' ')||'upstream_mcp_error';
      quoteProvenance.mcp_failure_class=classifyCmcQuoteFailure(msg);
      // Avoid storing upstream error text, which could contain sensitive details.
      quotes={isError:true,error:'cmc_quotes_upstream_error'};
    }
  } catch (error) {
    quoteProvenance.mcp_failure_class=classifyCmcQuoteFailure(error?.message||String(error));
    quotes={isError:true,error:'cmc_quotes_transport_error'};
  }
  const primaryFeatures=extractLearningFeatures({assets:cleanAssets,cmc_ids:cmcIds,quotes});
  const primaryCovered=cleanAssets.every(asset=>Number(primaryFeatures.assets?.[asset]?.price_usd)>0);
  if (!primaryCovered && String(process.env.LEARNING_CMC_PUBLIC_QUOTE_FALLBACK||'false').toLowerCase()==='true') {
    quoteProvenance.public_fallback_attempted=true;
    try {
      // One free, unauthenticated official CMC call, no retries or unverified markets.
      const alternate=await fetchCmcPublicQuotes({assets:cleanAssets,cmcIds});
      quotes=alternate;
      quoteProvenance.source='cmc_public_v3_keyless';
    }catch(error){
      // The primary partial response, if any, stays intact; still fail closed
      // on unverified assets. Record only whitelisted classifications.
      const m=String(error?.message||'');
      quoteProvenance.public_fallback_error_class=/^cmc_public_[a-z0-9_]+$/.test(m)?m:classifyCmcQuoteFailure(m);
    }
  }

  const afterCmc=extractLearningFeatures({assets:cleanAssets,cmc_ids:cmcIds,quotes});
  const cmcCovered=cleanAssets.every(asset=>Number(afterCmc.assets?.[asset]?.price_usd)>0);
  if(!cmcCovered && String(process.env.LEARNING_COINPAPRIKA_FALLBACK||'false').toLowerCase()==='true'){
    quoteProvenance.coinpaprika_fallback_attempted=true;
    try{
      // Only research snapshots. Three official source tickers, no paid data calls,
      // strict asset identity, USD, <=30m freshness, all 3 assets required.
      const alternate=await fetchCoinPaprikaQuotes({assets:cleanAssets});
      quotes=alternate;
      quoteProvenance.source='coinpaprika_public';
    }catch(error){
      const m=String(error?.message||'');
      quoteProvenance.coinpaprika_error_class=/^paprika_[a-z0-9_]+$/.test(m)?m:'paprika_unclassified_error';
    }
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

  const microstructurePromise = includeMicrostructure
    ? buildMicrostructureSnapshot({
        assets: cleanAssets,
        quotes,
        technicals: assetTechnicals,
        market,
        captureMs
      }).catch(error => ({
        isError: true,
        error: error?.message || String(error),
        note: 'CMC core data is still valid. Do not infer manipulation from a failed Bitso microstructure capture.'
      }))
    : Promise.resolve(null);

  const defiFundamentalsPromise = buildDefiFundamentalsForAssets(cleanAssets).catch(error => ({
    available: false,
    isError: true,
    error: error?.message || String(error),
    note: 'CMC/Bitso data remains valid. Missing DefiLlama fundamentals must not be inferred.'
  }));

  const [microstructure, defiFundamentals] = await Promise.all([microstructurePromise, defiFundamentalsPromise]);

  return {
    snapshot_version: '0.6.2',
    generated_at: new Date().toISOString(),
    providers: ['CoinMarketCap MCP via private CMC Gateway', 'Bitso public REST/WebSocket', 'DefiLlama Free API'],
    mode: 'read_only_decision_support',
    execution_enabled: false,
    snapshot_depth: includeMicrostructure ? 'core_plus_microstructure_v3_plus_defi_fundamentals_v1' : 'core_plus_defi_fundamentals_v1',
    assets: cleanAssets,
    cmc_ids: Object.fromEntries(cleanAssets.map(a => [a, resolved[a].id])),
    market,
    quotes,
    quote_provenance:quoteProvenance,
    asset_technicals: assetTechnicals,
    relative_strength: relativeStrength,
    microstructure,
    defi_fundamentals: defiFundamentals,
    guardrails: {
      no_manipulation_claim_without_evidence: true,
      high_trap_risk_requires_confirmation: true,
      high_crowding_requires_retest_or_spot_confirmation: true,
      venue_signal_is_execution_context_not_a_trade_command: true,
      low_microstructure_confidence_cannot_create_a_trade_signal: true,
      cancellation_metrics_require_matched_lifecycles: true,
      cancellation_only_samples_are_downweighted: true,
      persistent_walls_are_directional_context_not_manipulation_claims: true,
      defi_fundamentals_cannot_create_buy_signal_alone: true,
      missing_defi_metrics_must_not_be_inferred: true
    },
    deep_research_note: 'Holder metrics, project info and per-asset news are fetched on demand via asset_research. Arbitrary DeFi candidates can be checked on demand with defi_protocol_research. The core CMC budget remains unchanged.',
    usage_note: 'Use CMC as structured market evidence, Bitso as execution-context evidence, and DefiLlama as a fundamental confirmation/degradation layer. v0.6.2 adds cached DeFi TVL/fees/revenue/stablecoin-liquidity context without increasing CMC calls. Defi fundamentals may confirm, degrade or veto a thesis, but never create a BUY by themselves. Validate material catalysts with primary/authoritative sources before changing a real-money position.'
  };
}

