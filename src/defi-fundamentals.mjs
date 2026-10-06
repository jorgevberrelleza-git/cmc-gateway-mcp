import { defillama, defillamaConfig } from './defillama-client.mjs';

const CACHE_MS = Math.max(60_000, Number(process.env.DEFILLAMA_CACHE_MS || 21_600_000));
const ENABLED = String(process.env.DEFILLAMA_ENABLED || 'true').toLowerCase() !== 'false';
const cache = new Map();

// Deliberately conservative mapping. Add symbols only after confirming the token maps
// cleanly to one DefiLlama protocol slug. Arbitrary protocols remain available through
// the standalone defi_protocol_research tool.
const ASSET_PROTOCOL_MAP = new Map([
  ['AAVE', 'aave']
]);

function nowMs() { return Date.now(); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function round(v, d = 2) { return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)); }
function pct(a, b) { return a == null || b == null || b === 0 ? null : ((a / b) - 1) * 100; }
function clamp(v, lo = 0, hi = 100) { return Math.min(hi, Math.max(lo, v)); }

async function cached(key, loader) {
  const item = cache.get(key);
  if (item && nowMs() - item.at < CACHE_MS) return { value: item.value, cache_hit: true, cached_at: new Date(item.at).toISOString() };
  const value = await loader();
  cache.set(key, { at: nowMs(), value });
  return { value, cache_hit: false, cached_at: null };
}

function getTvlSeries(protocol) {
  const candidates = [protocol?.tvl, protocol?.tvlHistory, protocol?.historicalTvl];
  const arr = candidates.find(Array.isArray) || [];
  return arr
    .map(x => ({ date: n(x?.date ?? x?.timestamp), value: n(x?.totalLiquidityUSD ?? x?.tvl ?? x?.value) }))
    .filter(x => x.date != null && x.value != null)
    .sort((a,b) => a.date - b.date);
}

function nearestBefore(series, targetTs) {
  let best = null;
  for (const p of series) {
    if (p.date <= targetTs) best = p;
    else break;
  }
  return best;
}

export function summarizeTvl(protocol, currentTvlFallback = null, nowSec = Math.floor(Date.now()/1000)) {
  const series = getTvlSeries(protocol);
  const current = n(series.at(-1)?.value) ?? n(currentTvlFallback) ?? n(protocol?.tvl);
  const p7 = nearestBefore(series, nowSec - 7*86400);
  const p30 = nearestBefore(series, nowSec - 30*86400);
  return {
    current_usd: round(current, 2),
    change_7d_pct: round(pct(current, p7?.value), 2),
    change_30d_pct: round(pct(current, p30?.value), 2),
    history_points: series.length,
    source: series.length ? 'protocol_history' : 'current_tvl_only'
  };
}

function chartPoints(summary) {
  const arr = Array.isArray(summary?.totalDataChart) ? summary.totalDataChart : [];
  return arr.map(row => {
    if (Array.isArray(row)) return { date: n(row[0]), value: n(row[1]) };
    return { date: n(row?.date ?? row?.timestamp), value: n(row?.value ?? row?.total ?? row?.fees ?? row?.revenue) };
  }).filter(x => x.date != null && x.value != null).sort((a,b)=>a.date-b.date);
}

function sumWindow(points, start, end) {
  return points.filter(p => p.date >= start && p.date < end).reduce((a,p)=>a+p.value, 0);
}

export function summarizeFlow(summary, nowSec = Math.floor(Date.now()/1000)) {
  const pts = chartPoints(summary);
  const end = nowSec + 86400;
  const this7 = sumWindow(pts, nowSec - 6*86400, end);
  const prior7 = sumWindow(pts, nowSec - 13*86400, nowSec - 6*86400);
  const this30 = sumWindow(pts, nowSec - 29*86400, end);
  const prior30 = sumWindow(pts, nowSec - 59*86400, nowSec - 29*86400);

  const total24h = n(summary?.total24h);
  const total7d = n(summary?.total7d) ?? (this7 || null);
  const use7 = total7d != null ? total7d : (this7 || null);
  return {
    current_24h_usd: round(total24h, 2),
    current_7d_usd: round(use7, 2),
    momentum_7d_vs_prior7d_pct: round(prior7 > 0 ? pct(this7, prior7) : null, 2),
    momentum_30d_vs_prior30d_pct: round(prior30 > 0 ? pct(this30, prior30) : null, 2),
    history_points: pts.length
  };
}

function stablecoinValue(row) {
  const tc = row?.totalCirculating;
  if (typeof tc === 'number') return tc;
  if (tc && typeof tc === 'object') {
    for (const key of ['peggedUSD','usd','total','value']) {
      const x = n(tc[key]);
      if (x != null) return x;
    }
    const vals = Object.values(tc).map(n).filter(x=>x!=null);
    if (vals.length) return vals.reduce((a,b)=>a+b,0);
  }
  return n(row?.value ?? row?.totalCirculatingUSD);
}

export function summarizeStablecoinContext(rows, nowSec = Math.floor(Date.now()/1000)) {
  const pts = (Array.isArray(rows) ? rows : []).map(x => ({ date: n(x?.date ?? x?.timestamp), value: stablecoinValue(x) }))
    .filter(x => x.date != null && x.value != null).sort((a,b)=>a.date-b.date);
  const cur = pts.at(-1);
  const p7 = nearestBefore(pts, nowSec - 7*86400);
  const p30 = nearestBefore(pts, nowSec - 30*86400);
  return {
    current_usd: round(cur?.value ?? null, 2),
    change_7d_pct: round(pct(cur?.value, p7?.value), 2),
    change_30d_pct: round(pct(cur?.value, p30?.value), 2),
    history_points: pts.length,
    scope: 'global_stablecoin_liquidity_context_not_protocol_specific'
  };
}

function scoreMetric(v, { pos2, pos1, neg1, neg2, w }) {
  if (v == null) return { delta: 0, counted: false };
  if (v >= pos2) return { delta: w, counted: true };
  if (v >= pos1) return { delta: w * 0.4, counted: true };
  if (v <= neg2) return { delta: -w, counted: true };
  if (v <= neg1) return { delta: -w * 0.4, counted: true };
  return { delta: 0, counted: true };
}

export function evaluateFundamentals({ tvl, fees, revenue, stablecoins }) {
  let score = 50, counted = 0;
  const details = [];
  const metrics = [
    ['tvl_7d', tvl?.change_7d_pct, { pos2: 5, pos1: 0, neg1: -0.01, neg2: -5, w: 12 }],
    ['tvl_30d', tvl?.change_30d_pct, { pos2: 10, pos1: 0, neg1: -0.01, neg2: -10, w: 12 }],
    ['fees_7d_momentum', fees?.momentum_7d_vs_prior7d_pct, { pos2: 15, pos1: 0, neg1: -0.01, neg2: -15, w: 16 }],
    ['revenue_7d_momentum', revenue?.momentum_7d_vs_prior7d_pct, { pos2: 15, pos1: 0, neg1: -0.01, neg2: -15, w: 16 }],
    ['stablecoin_7d', stablecoins?.change_7d_pct, { pos2: 1, pos1: 0, neg1: -0.01, neg2: -1, w: 8 }]
  ];
  for (const [name, value, cfg] of metrics) {
    const s = scoreMetric(value, cfg);
    score += s.delta;
    if (s.counted) counted++;
    details.push({ metric: name, value, contribution: round(s.delta, 2), counted: s.counted });
  }
  if (counted < 3) {
    return {
      fundamental_quality_0_100: null,
      confirmation: 'insufficient_data',
      confidence_0_100: Math.round((counted/5)*100),
      components: details,
      actionability: 'context_only_no_trade_signal'
    };
  }
  const final = Math.round(clamp(score));
  return {
    fundamental_quality_0_100: final,
    confirmation: final >= 65 ? 'confirms' : final <= 35 ? 'contradicts' : 'neutral',
    confidence_0_100: Math.round((counted/5)*100),
    components: details,
    actionability: 'may_confirm_degrade_or_veto_but_never_create_buy_signal'
  };
}

export async function buildDefiProtocolResearch(slug, { includeStablecoinContext = true } = {}) {
  if (!ENABLED) return { available: false, reason: 'defillama_disabled' };
  const clean = String(slug || '').trim().toLowerCase();
  if (!clean) throw new Error('protocol slug is required');

  const protocolC = await cached(`protocol:${clean}`, () => defillama.protocol(clean));
  const tvlC = await cached(`tvl:${clean}`, () => defillama.currentTvl(clean));
  const feesC = await cached(`fees:${clean}`, () => defillama.feeSummary(clean, 'dailyFees'));
  const revenueC = await cached(`revenue:${clean}`, () => defillama.feeSummary(clean, 'dailyRevenue'));
  let stablesC = null;
  if (includeStablecoinContext) stablesC = await cached('stablecoincharts:all', () => defillama.stablecoinChartAll());

  const tvl = summarizeTvl(protocolC.value, tvlC.value);
  const fees = summarizeFlow(feesC.value);
  const revenue = summarizeFlow(revenueC.value);
  const stablecoins = stablesC ? summarizeStablecoinContext(stablesC.value) : null;
  const evaluation = evaluateFundamentals({ tvl, fees, revenue, stablecoins });

  return {
    available: true,
    provider: 'DefiLlama Free API',
    protocol_slug: clean,
    name: protocolC.value?.name || feesC.value?.name || revenueC.value?.name || clean,
    symbol: protocolC.value?.symbol || feesC.value?.symbol || revenueC.value?.symbol || null,
    category: protocolC.value?.category || feesC.value?.category || revenueC.value?.category || null,
    chains: protocolC.value?.chains || feesC.value?.chains || [],
    tvl,
    fees,
    revenue,
    stablecoin_liquidity_context: stablecoins,
    evaluation,
    cache: {
      ttl_ms: CACHE_MS,
      protocol_cache_hit: protocolC.cache_hit,
      fees_cache_hit: feesC.cache_hit,
      revenue_cache_hit: revenueC.cache_hit,
      stablecoins_cache_hit: stablesC?.cache_hit ?? null
    },
    data_policy: {
      no_api_key_required: true,
      fundamentals_are_confirmation_context_not_entry_trigger: true,
      stablecoin_context_is_global_not_aave_specific: true,
      missing_metrics_must_not_be_inferred: true
    }
  };
}

export async function buildDefiFundamentalsForAssets(assets = []) {
  if (!ENABLED) return { available: false, reason: 'defillama_disabled' };
  const out = {};
  for (const asset of assets.map(x=>String(x||'').toUpperCase())) {
    const slug = ASSET_PROTOCOL_MAP.get(asset);
    if (!slug) continue;
    try {
      out[asset] = await buildDefiProtocolResearch(slug, { includeStablecoinContext: true });
    } catch (error) {
      out[asset] = { available: false, error: error?.message || String(error) };
    }
  }
  return {
    available: Object.keys(out).length > 0,
    provider: 'DefiLlama Free API',
    generated_at: new Date().toISOString(),
    assets: out,
    supported_asset_map: Object.fromEntries(ASSET_PROTOCOL_MAP),
    note: Object.keys(out).length ? 'Fundamentals are a confirmation/degradation layer only and cannot independently create a BUY.' : 'No supported DeFi protocol asset in this snapshot.',
    config: { ...defillamaConfig(), cache_ms: CACHE_MS, enabled: ENABLED }
  };
}
