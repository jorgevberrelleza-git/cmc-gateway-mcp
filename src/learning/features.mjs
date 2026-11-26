// CMC MCP replies can include structuredContent and a text/JSON version
// simultaneously. Traverse both; a table nested in either one must not disappear.
function parsePayload(block) {
  if (Array.isArray(block)) return block;
  if (block == null) return null;
  const structured = block?.structuredContent ?? null;
  const json = block?.content_json ?? null;
  const text = block?.content?.find?.(item => item?.type === 'text')?.text;
  let parsedText = null;
  if (typeof text === 'string') {
    try { parsedText = JSON.parse(text); } catch {}
  }
  if (structured != null || json != null || parsedText != null) {
    return { structuredContent: structured, content_json: json ?? parsedText };
  }
  return block;
}
function positive(value) {
  if (typeof value === 'boolean' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function usdQuote(asset) {
  const q = asset?.quote;
  if (!q) return null;
  if (Array.isArray(q)) return q.find(x => String(x?.symbol || x?.convert_symbol || x?.currency || '').toUpperCase() === 'USD') ?? null;
  if (typeof q === 'object') {
    if (q.USD && typeof q.USD === 'object') return q.USD;
    if (q.usd && typeof q.usd === 'object') return q.usd;
    if (String(q.symbol || q.convert_symbol || '').toUpperCase() === 'USD') return q;
  }
  return null;
}
function flattenQuoteAsset(asset, key = null) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return null;
  const usd = usdQuote(asset);
  const symbol = asset.symbol ?? asset.asset_symbol ?? (/[A-Za-z]{2,10}/.test(String(key || '')) && !/^\\d+$/.test(String(key)) ? key : null);
  const id = asset.id ?? (/^\\d+$/.test(String(key || '')) ? key : null);
  return {
    ...asset,
    ...(usd || {}),
    symbol: symbol ?? null,
    id: id ?? null,
    quote_symbol: usd ? 'USD' : (asset.quote_symbol ?? null)
  };
}
function rawPrice(row) {
  if (!row || typeof row !== 'object') return null;
  // Reject a non-USD quote; never silently treat a stablecoin quote as USD.
  const currency = String(row.quote_symbol || row.convert_symbol || row.convert || '').toUpperCase();
  if (currency && currency !== 'USD') return null;
  return positive(row.price_usd ?? row.price ?? row['price (usd)'] ?? row['Price (USD)']);
}
function normalizeQuoteRowsPayload(input, depth = 0, seen = new WeakSet()) {
  if (input == null || depth > 12 || typeof input !== 'object') return [];
  if (seen.has(input)) return [];
  seen.add(input);
  if (Array.isArray(input)) return input.flatMap(v => normalizeQuoteRowsPayload(v, depth + 1, seen));
  if (input.isError === true || input.error) return [];
  if (Array.isArray(input.headers) && Array.isArray(input.rows)) {
    return input.rows.filter(Array.isArray).map(row => Object.fromEntries(input.headers.map((h,i) => [h,row[i]])));
  }
  // USD table and direct CMC asset objects.
  if ((input.symbol || input.asset_symbol || input.id) && (input.price != null || input.price_usd != null || input.quote != null)) {
    const flat = flattenQuoteAsset(input);
    return flat ? [flat] : [];
  }
  if (input.data != null) {
    const data = input.data;
    if (Array.isArray(data)) return normalizeQuoteRowsPayload(data,depth+1,seen);
    if (typeof data === 'object') return Object.entries(data).flatMap(([key,v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && (v.price != null || v.price_usd != null || v.quote)) {
        return [flattenQuoteAsset(v,key)].filter(Boolean);
      }
      return normalizeQuoteRowsPayload(v,depth+1,seen);
    });
  }
  const wrappers=['structuredContent','content_json','result','payload','response'];
  const found=wrappers.flatMap(k=>normalizeQuoteRowsPayload(input[k],depth+1,seen));
  if(found.length) return found;
  // Numeric CMC ID keys and ticker keys when data/result wrappers are absent.
  return Object.entries(input).flatMap(([key,value]) => {
    if(wrappers.includes(key)) return [];
    if(value && typeof value === 'object' && !Array.isArray(value) && (value.price != null || value.price_usd != null || value.quote)) {
      return [flattenQuoteAsset(value,key)].filter(Boolean);
    }
    return normalizeQuoteRowsPayload(value,depth+1,seen);
  });
}
function quoteMap(snapshot) {
  const requested=(snapshot?.assets||[]).map(x=>String(x).toUpperCase());
  const byId=Object.fromEntries(requested.filter(s=>snapshot?.cmc_ids?.[s]!=null).map(s=>[String(snapshot.cmc_ids[s]),s]));
  const out={};
  for(const row of normalizeQuoteRowsPayload(parsePayload(snapshot?.quotes))) {
    const symbol=String(row.symbol || byId[String(row.id)] || '').toUpperCase();
    if (!requested.includes(symbol) || rawPrice(row)==null) continue;
    if (!out[symbol]) out[symbol]={...row,symbol};
  }
  return out;
}
export function quoteExtractionDiagnostics(snapshot={}) {
  const block=snapshot?.quotes;
  const rows=normalizeQuoteRowsPayload(parsePayload(block));
  const features=quoteMap(snapshot);
  return {
    quote_error_flag:block?.isError === true,
    has_structured_content:block?.structuredContent != null,
    has_text_content:Array.isArray(block?.content) && block.content.some(x=>x.type==='text'),
    top_level_keys:block && typeof block==='object' ? Object.keys(block).slice(0,12) : [],
    parsed_rows:Object.keys(features).length,
    received_rows:rows.length,
    duplicated_representations:Math.max(0,rows.length-Object.keys(features).length),
    symbol_coverage:Object.fromEntries((snapshot?.assets||[]).map(s=>{
      const row=features[String(s).toUpperCase()];
      return [s,{matched:!!row,usd_price_present:!!row && rawPrice(row)!=null}];
    }))
  };
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
      price_usd: rawPrice(q),
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
