// Owner success metric and venue-price sanity, computed inside the engine (pure).
// - extra vs HOLD: mandate value minus the value of simply holding the mandated
//   units, both at the SAME Bitso mid, so the daily review no longer depends on
//   external price lookups.
// - quote check: Bitso mid vs the independent Kraken reference, so an anomalous
//   venue quote (like the one suspected at the 2026-11-20 paper exit) is visible
//   every hour. Informational: the executor's own 2% price collar still decides.
export const METRICS_VERSION = 'shadow-mandate-metrics-v0.1';

const r2 = x => Math.round(x * 100) / 100;
const mid = q => (q && q.bid > 0 && q.ask >= q.bid) ? (q.bid + q.ask) / 2 : null;

export function holdVsMandate({ mandate, quotes, mandateUsd }) {
  if (!(mandateUsd > 0) || !mandate) return null;
  let holdUsd = 0;
  for (const [a, units] of Object.entries(mandate)) {
    const m = mid(quotes?.[a]);
    if (!(m > 0)) return null;
    holdUsd += Number(units) * m;
  }
  const extraUsd = mandateUsd - holdUsd;
  return { holdUsd: r2(holdUsd), mandateUsd: r2(mandateUsd), extraUsd: r2(extraUsd), extraPct: r2(100 * extraUsd / holdUsd), pricedWith: 'bitso_mid' };
}

export function quoteCheck({ quotes, refPrices, warnPct = 2 }) {
  const out = {};
  for (const [a, q] of Object.entries(quotes || {})) {
    const m = mid(q), ref = Number(refPrices?.[a]);
    if (!(m > 0) || !(ref > 0)) { out[a] = { devPct: null }; continue; }
    const devPct = r2(100 * (m / ref - 1));
    out[a] = { bitsoMid: +m.toPrecision(8), krakenRef: +ref.toPrecision(8), devPct, warn: Math.abs(devPct) > warnPct };
  }
  return out;
}
