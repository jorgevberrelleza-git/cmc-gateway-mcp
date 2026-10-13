function parsePayload(block) {
  if (Array.isArray(block)) return block;
  const structured = block?.structuredContent ?? null;
  const text = block?.content?.find?.(item => item?.type === 'text')?.text;
  let parsedText = null;
  if (typeof text === 'string') {
    try { parsedText = JSON.parse(text); } catch {}
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

function quoteRows(snapshot) {
  return normalizeQuoteRowsPayload(parsePayload(snapshot?.quotes));
}
function findAssetQuote(value, symbol, cmcId, depth = 0) {
  if (value == null || depth > 10) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAssetQuote(item, symbol, cmcId, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  const objectSymbol = String(value.symbol || value.asset_symbol || '').toUpperCase();
  const objectId = value.id == null ? null : String(value.id);
  if (objectSymbol === symbol || (cmcId && objectId === String(cmcId))) {
    const flat = flattenQuoteAsset(value);
    if (flat && Number.isFinite(Number(flat.price ?? flat.price_usd))) {
      return { ...flat, symbol };
    }
  }

  const direct = value[symbol] ?? (cmcId ? value[String(cmcId)] : undefined);
  if (direct && typeof direct === 'object') {
    const flat = flattenQuoteAsset(direct);
    if (flat && Number.isFinite(Number(flat.price ?? flat.price_usd))) {
      return { ...flat, symbol };
    }
    const nested = findAssetQuote(direct, symbol, cmcId, depth + 1);
    if (nested) return nested;
  }

  for (const child of Object.values(value)) {
    const found = findAssetQuote(child, symbol, cmcId, depth + 1);
    if (found) return found;
  }
  return null;
}

function quoteMap(snapshot) {
  const requested = (snapshot?.assets || []).map(x => String(x).toUpperCase());
  const out = {};
  for (const row of quoteRows(snapshot)) {
    const symbol = String(row?.symbol || '').toUpperCase();
    if (requested.includes(symbol)) out[symbol] = row;
  }

  const payload = parsePayload(snapshot?.quotes);
  for (const symbol of requested) {
    if (out[symbol]) continue;
    const found = findAssetQuote(payload, symbol, snapshot?.cmc_ids?.[symbol]);
    if (found) out[symbol] = found;
  }
  return out;
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
  const prices = Object.fromEntries(Object.entries(features.assets)
    .filter(([, value]) => Number.isFinite(Number(value.price_usd)) && Number(value.price_usd) > 0)
    .map(([symbol, value]) => [symbol, Number(value.price_usd)]));

  for (const symbol of snapshot?.assets || []) {
    const s = String(symbol).toUpperCase();
    if (Number.isFinite(Number(prices[s])) && Number(prices[s]) > 0) continue;

    const micro = snapshot?.microstructure?.assets?.[s] || {};
    const minor = String(micro?.minor_currency || '').toLowerCase();
    const mid = Number(micro?.order_book?.mid);

    if (['usd', 'usdc', 'usdt'].includes(minor) && Number.isFinite(mid) && mid > 0) {
      prices[s] = mid;
    }
  }

  return prices;
}
