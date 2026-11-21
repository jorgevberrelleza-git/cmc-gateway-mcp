// Shadow trend filter v0.7 — RESEARCH / PAPER ONLY.
//
// Rationale (docs/shadow-trend-filter-v07.md): an independent 2021-2026 replay
// showed the v0.4 momentum votes have no directional skill (hit rate <= 50%)
// and, used as an exit rule, trade too often to survive Bitso costs. A single,
// pre-declared, slow trend filter (close > SMA200 of daily closes) roughly
// halved max drawdown for BTC/ETH/ADA and stayed robust at 0.80% per side.
//
// This module is pure: no network, no DB, no broker. It NEVER authorises live
// orders; `tradeable` is always false and callers must keep execution disabled.

export const TREND_FILTER_VERSION = 'shadow_trend_filter_v0.7';
export const TREND_FILTER_PARAMS = Object.freeze({
  smaDays: 200,
  // Frozen before prospective evaluation. Changing these requires a new
  // version string and a fresh prospective window.
  minHistoryDays: 200,
  maxLastCloseAgeHours: 36
});

const DAY_MS = 86_400_000;

function fail(code) { throw new Error('trend_filter_v07:' + code); }

/**
 * Validate and normalise daily closes.
 * @param {Array<{t:number|string, close:number}>} candles closed daily candles (UTC open time)
 */
export function normaliseDailyCloses(candles) {
  if (!Array.isArray(candles)) fail('candles_not_array');
  const rows = candles.map(c => ({ t: typeof c.t === 'string' ? Date.parse(c.t) : Number(c.t), close: Number(c.close) }));
  for (const r of rows) {
    if (!Number.isFinite(r.t) || !(r.close > 0)) fail('invalid_candle');
    if (r.t % DAY_MS !== 0) fail('candle_not_utc_day_aligned');
  }
  rows.sort((a, b) => a.t - b.t);
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].t - rows[i - 1].t;
    if (gap === 0) fail('duplicate_day');
    if (gap !== DAY_MS) fail('gap_in_daily_history');
  }
  return rows;
}

/**
 * Compute the frozen posture for one asset as of `now`.
 * Only candles whose day has fully CLOSED before `now` are used (no lookahead).
 */
export function trendPosture({ asset, candles, now = new Date(), params = TREND_FILTER_PARAMS }) {
  if (!asset) fail('asset_required');
  const nowMs = +now;
  const closed = normaliseDailyCloses(candles).filter(r => r.t + DAY_MS <= nowMs);
  const base = { version: TREND_FILTER_VERSION, asset, asOf: new Date(nowMs).toISOString(),
    tradeable: false, realOrdersAllowed: false };
  if (closed.length < params.minHistoryDays) {
    return { ...base, posture: 'ABSTAIN', reason: 'insufficient_history', historyDays: closed.length };
  }
  const last = closed[closed.length - 1];
  const ageH = (nowMs - (last.t + DAY_MS)) / 3_600_000;
  if (ageH > params.maxLastCloseAgeHours) {
    return { ...base, posture: 'ABSTAIN', reason: 'stale_history', lastCloseAgeHours: +ageH.toFixed(2) };
  }
  const window = closed.slice(-params.smaDays);
  const sma = window.reduce((s, r) => s + r.close, 0) / window.length;
  const distancePct = (last.close / sma - 1) * 100;
  return {
    ...base,
    posture: last.close > sma ? 'RISK_ON' : 'RISK_OFF',
    reason: 'close_vs_sma' + params.smaDays,
    lastClose: last.close,
    lastCloseDay: new Date(last.t).toISOString().slice(0, 10),
    sma: +sma.toFixed(8),
    distancePct: +distancePct.toFixed(3)
  };
}

/** Paper-only target weights: equal split of `maxExposure` across RISK_ON assets. */
export function paperTargetWeights(postures, { maxExposure = 0.6, maxAssetWeight = 0.2 } = {}) {
  const on = postures.filter(p => p.posture === 'RISK_ON').map(p => p.asset);
  const w = on.length ? Math.min(maxAssetWeight, maxExposure / on.length) : 0;
  const weights = Object.fromEntries(postures.map(p => [p.asset, on.includes(p.asset) ? +w.toFixed(6) : 0]));
  const cash = +(1 - on.length * w).toFixed(6);
  return { version: TREND_FILTER_VERSION, weights, cash, tradeable: false, realOrdersAllowed: false };
}
