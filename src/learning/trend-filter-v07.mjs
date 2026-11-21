// Shadow trend filter v0.7 — RESEARCH / PAPER ONLY.
//
// Evidence (docs/shadow-trend-filter-v07.md): in a single 2021-2026 history the
// pre-declared rule "close > SMA200 of daily closes" roughly halved max drawdown
// for BTC and ETH, but FAILED for LINK and XRP and was mixed for ADA/AAVE. The
// universe is therefore restricted to BTC and ETH. This is a candidate for
// prospective paper validation, not a proven edge.
//
// Pure: no network, no DB, no broker. `tradeable` is always false.

export const TREND_FILTER_VERSION = 'shadow_trend_filter_v0.7.1';
export const TREND_FILTER_UNIVERSE = Object.freeze(['BTC', 'ETH']);
export const TREND_FILTER_PARAMS = Object.freeze({
  smaDays: 200,
  minHistoryDays: 200,
  maxLastCloseAgeHours: 36,
  maxAbstainKeepDays: 3
});
// Sized so the strategy's historical drawdown (~40% at full exposure for
// BTC/ETH) stays well inside the v0.6 paper limits (10% DD, 2% day loss):
// 15% total exposure => ~6% portfolio DD; a 2% day loss needs a ~13% basket drop.
export const TREND_FILTER_PAPER_SIZING = Object.freeze({ maxExposure: 0.15, maxAssetWeight: 0.075 });

const DAY_MS = 86_400_000;
function fail(code) { throw new Error('trend_filter_v07:' + code); }

/** Validate daily closes; throws on malformed input (use trendPosture for fail-closed postures). */
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
 * Frozen posture for one asset as of `now`. Never throws on bad data: returns
 * ABSTAIN with the reason. Only candles whose UTC day has closed are used.
 */
export function trendPosture({ asset, candles, now = new Date(), params = TREND_FILTER_PARAMS, universe = TREND_FILTER_UNIVERSE }) {
  const nowMs = +now;
  const base = { version: TREND_FILTER_VERSION, asset, asOf: new Date(nowMs).toISOString(),
    tradeable: false, realOrdersAllowed: false };
  // `universe` lets an owner mandate (e.g. ADA) reuse the SAME frozen rule; the paper ledger keeps the default.
  if (!universe.includes(asset)) return { ...base, posture: 'ABSTAIN', reason: 'asset_outside_universe' };
  let rows;
  try { rows = normaliseDailyCloses(candles); }
  catch (e) { return { ...base, posture: 'ABSTAIN', reason: String(e.message).replace('trend_filter_v07:', '') }; }
  const closed = rows.filter(r => r.t + DAY_MS <= nowMs);
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
  return {
    ...base,
    posture: last.close > sma ? 'RISK_ON' : 'RISK_OFF',
    reason: 'close_vs_sma' + params.smaDays,
    lastClose: last.close,
    lastCloseDay: new Date(last.t).toISOString().slice(0, 10),
    sma: +sma.toFixed(8),
    distancePct: +((last.close / sma - 1) * 100).toFixed(3)
  };
}

/**
 * Paper-only target weights. RISK_ON -> per-asset weight; RISK_OFF -> 0;
 * ABSTAIN (data failure) -> KEEP the previous weight for up to 3 consecutive
 * days (a short outage never forces a liquidation, as in the v0.6 broker);
 * from the 3rd consecutive ABSTAIN day the weight goes to 0.
 */
export function paperTargetWeights(postures, { previousWeights = {}, abstainDays = {}, sizing = TREND_FILTER_PAPER_SIZING } = {}) {
  const { maxExposure, maxAssetWeight } = sizing;
  if (!(maxExposure > 0 && maxExposure <= 0.6 && maxAssetWeight > 0 && maxAssetWeight <= 0.2)) fail('unsafe_sizing');
  const assets = postures.map(p => p.asset);
  if (new Set(assets).size !== assets.length) fail('duplicate_asset');
  const per = Math.min(maxAssetWeight, maxExposure / Math.max(1, TREND_FILTER_UNIVERSE.length));
  const weights = {};
  for (const p of postures) {
    if (!TREND_FILTER_UNIVERSE.includes(p.asset)) { weights[p.asset] = 0; continue; }
    const prev = Number(previousWeights[p.asset]) || 0;
    // ABSTAIN keeps the prior weight for at most MAX_ABSTAIN_KEEP_DAYS consecutive
    // days; a longer outage is treated as RISK_OFF so stale exposure cannot persist.
    const stale = (Number(abstainDays[p.asset]) || 0) >= TREND_FILTER_PARAMS.maxAbstainKeepDays;
    weights[p.asset] = p.posture === 'RISK_ON' ? per : p.posture === 'RISK_OFF' || stale ? 0 : Math.min(prev, per);
  }
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  if (total > maxExposure + 1e-9) fail('exposure_cap_breached');
  return { version: TREND_FILTER_VERSION, weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, +v.toFixed(6)])),
    cash: +(1 - total).toFixed(6), tradeable: false, realOrdersAllowed: false };
}
