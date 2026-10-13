function parsePayload(block) {
  if (block?.structuredContent != null) return block.structuredContent;
  if (Array.isArray(block)) return block;
  const text = block?.content?.find?.(item => item?.type === 'text')?.text;
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function quoteRows(snapshot) {
  const parsed = parsePayload(snapshot?.quotes);
  if (Array.isArray(parsed)) return parsed;
  const headers = parsed?.headers;
  const rows = parsed?.rows;
  if (!Array.isArray(headers) || !Array.isArray(rows)) return [];
  return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row?.[i]])));
}

function quoteMap(snapshot) {
  return Object.fromEntries(quoteRows(snapshot).map(row => [String(row.symbol || '').toUpperCase(), row]));
}

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

export function extractLearningFeatures(snapshot) {
  const quotes = quoteMap(snapshot);
  const microAssets = snapshot?.microstructure?.assets || {};
  const defiAssets = snapshot?.defi_fundamentals?.assets || {};
  const assets = {};

  for (const symbol of snapshot?.assets || Object.keys(quotes)) {
    const s = String(symbol).toUpperCase();
    const q = quotes[s] || {};
    const micro = microAssets[s] || {};
    const defi = defiAssets[s] || {};
    assets[s] = {
      price_usd: n(q.price ?? q.price_usd),
      pct_1h: n(q.percent_change_1h),
      pct_24h: n(q.percent_change_24h),
      pct_7d: n(q.percent_change_7d),
      pct_30d: n(q.percent_change_30d),
      trap_risk: micro?.scores?.trap_risk_0_100 ?? null,
      crowding_risk: micro?.scores?.crowding_risk_0_100 ?? null,
      spot_confirmation: micro?.scores?.spot_confirmation_0_100 ?? null,
      persistent_wall_pressure: micro?.scores?.persistent_wall_pressure_minus100_to100 ?? null,
      microstructure_confidence: micro?.scores?.microstructure_confidence_0_100 ?? null,
      execution_gate: micro?.execution_context_gate ?? null,
      fundamental_quality: defi?.evaluation?.fundamental_quality_0_100 ?? null,
      fundamental_confirmation: defi?.evaluation?.confirmation ?? null,
      tvl_7d_pct: defi?.tvl?.change_7d_pct ?? null,
      fees_7d_momentum_pct: defi?.fees?.momentum_7d_vs_prior7d_pct ?? null,
      revenue_7d_momentum_pct: defi?.revenue?.momentum_7d_vs_prior7d_pct ?? null
    };
  }

  return {
    snapshot_version: snapshot?.snapshot_version ?? null,
    generated_at: snapshot?.generated_at ?? null,
    assets
  };
}

export function extractUsdPrices(snapshot) {
  const features = extractLearningFeatures(snapshot);
  return Object.fromEntries(Object.entries(features.assets)
    .filter(([, value]) => Number.isFinite(Number(value.price_usd)) && Number(value.price_usd) > 0)
    .map(([symbol, value]) => [symbol, Number(value.price_usd)]));
}
