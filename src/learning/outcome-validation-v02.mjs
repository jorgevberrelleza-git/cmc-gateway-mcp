import { unpackMcp, finiteNumber } from './data-consistency.mjs';

export const V02_OUTCOME_HORIZONS_MS = Object.freeze({
  '1h': 1 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000
});

export function quotePriceMap(snapshot = {}) {
  const payload = unpackMcp(snapshot?.quotes);
  const out = {};
  if (Array.isArray(payload?.headers) && Array.isArray(payload?.rows)) {
    for (const row of payload.rows) {
      const q = Object.fromEntries(payload.headers.map((h, i) => [h, row?.[i]]));
      const symbol = String(q.symbol || '').toUpperCase();
      const price = finiteNumber(q.price ?? q.price_usd ?? q.quote_price);
      if (symbol && price != null && price > 0) out[symbol] = price;
    }
  }
  if (payload?.data && typeof payload.data === 'object') {
    for (const asset of Object.values(payload.data)) {
      const symbol = String(asset?.symbol || '').toUpperCase();
      const usd = asset?.quote?.USD || asset?.quote?.usd || null;
      const price = finiteNumber(usd?.price ?? asset?.price);
      if (symbol && price != null && price > 0) out[symbol] = price;
    }
  }
  return out;
}

export function eventAssets(materialEvent = {}) {
  return [...new Set((materialEvent?.reasons || [])
    .map(r => String(r).split(':')[0]?.toUpperCase())
    .filter(Boolean))];
}

export function evaluateEventOutcomeV02({ eventSnapshot, laterSnapshot, materialEvent } = {}) {
  const before = quotePriceMap(eventSnapshot);
  const after = quotePriceMap(laterSnapshot);
  const assets = eventAssets(materialEvent);
  const perAsset = {};
  for (const asset of assets) {
    const p0 = before[asset], p1 = after[asset];
    if (!(p0 > 0) || !(p1 > 0)) {
      perAsset[asset] = { available: false, reason: 'quote_missing' };
      continue;
    }
    const ret = ((p1 - p0) / p0) * 100;
    perAsset[asset] = {
      available: true,
      reference_price_usd: p0,
      later_price_usd: p1,
      return_pct: Number(ret.toFixed(4)),
      abs_return_pct: Number(Math.abs(ret).toFixed(4))
    };
  }
  const usable = Object.entries(perAsset).filter(([,v]) => v.available);
  const maxAbs = usable.length ? Math.max(...usable.map(([,v]) => v.abs_return_pct)) : null;
  return {
    assets: perAsset,
    max_abs_return_pct: maxAbs,
    directional_move_ge_1pct: maxAbs != null ? maxAbs >= 1 : null,
    directional_move_ge_2pct: maxAbs != null ? maxAbs >= 2 : null
  };
}

export function summarizeOutcomeCohorts(rows = []) {
  const byCohort = { research_candidate: [], filtered_context: [] };
  for (const row of rows) {
    byCohort[row.research_candidate ? 'research_candidate' : 'filtered_context'].push(row);
  }
  const summarize = list => {
    const vals = list.map(x => x.max_abs_return_pct).filter(Number.isFinite);
    return {
      n: list.length,
      n_with_price: vals.length,
      avg_max_abs_return_pct: vals.length ? Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(4)) : null,
      move_ge_1pct_rate: vals.length ? Number((100 * vals.filter(x=>x>=1).length / vals.length).toFixed(2)) : null,
      move_ge_2pct_rate: vals.length ? Number((100 * vals.filter(x=>x>=2).length / vals.length).toFixed(2)) : null
    };
  };
  return {
    research_candidate: summarize(byCohort.research_candidate),
    filtered_context: summarize(byCohort.filtered_context)
  };
}
