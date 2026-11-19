// SHADOW TIME MACHINE v0.1
// Pure, offline, deterministic. No exchange clients, network, credentials, DB, or orders.
// Only committed policies are permitted. All strategy decisions observe CLOSED bars.
import crypto from 'node:crypto';

const ASSETS = Object.freeze(['BTC', 'ADA', 'AAVE']);
const DAY_MS = 86_400_000;
const isFinitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const round = (v, digits = 8) => Number(v.toFixed(digits));

function assert(condition, message) {
  if (!condition) throw new Error('time_machine:' + message);
}
function canonicalHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
function epochMs(value) {
  const x = Number(value);
  assert(Number.isSafeInteger(x), 'invalid_timestamp');
  return x;
}

// Strict contiguous OHLC bars, with explicit open and close time. Missing bars
// fail closed rather than generating invisible fills across missing sessions.
export function validateSeries(series, { stepMs = DAY_MS } = {}) {
  assert(series && typeof series === 'object', 'series_required');
  assert(Number.isSafeInteger(stepMs) && stepMs >= 60_000, 'invalid_step');
  const normalized = {};
  for (const asset of ASSETS) {
    const input = series[asset];
    assert(Array.isArray(input) && input.length >= 3, 'missing_bars_' + asset);
    assert(input.length <= 100_000, 'too_many_bars_' + asset);
    let previous = null;
    normalized[asset] = input.map((b, i) => {
      const openTime = epochMs(b.openTime ?? b.time);
      const closeTime = epochMs(b.closeTime ?? (openTime + stepMs - 1));
      const out = {
        openTime, closeTime,
        open: Number(b.open), high: Number(b.high), low: Number(b.low),
        close: Number(b.close), volume: Number(b.volume ?? 0)
      };
      assert(openTime >= Date.UTC(2010, 0, 1) && openTime < Date.UTC(2100, 0, 1), 'timestamp_out_of_bounds_' + asset);
      assert(closeTime >= openTime && closeTime < openTime + stepMs, 'bar_close_outside_interval_' + asset);
      assert([out.open, out.high, out.low, out.close].every(isFinitePositive), 'invalid_price_' + asset + '_' + i);
      assert(Number.isFinite(out.volume) && out.volume >= 0, 'invalid_volume_' + asset + '_' + i);
      assert(out.high >= Math.max(out.open, out.close, out.low) && out.low <= Math.min(out.open, out.close), 'bad_ohlc_' + asset + '_' + i);
      if (previous != null) assert(openTime - previous === stepMs, 'gap_or_duplicate_' + asset + '_' + i);
      previous = openTime;
      return Object.freeze(out);
    });
  }
  const timestamps = new Set(normalized.BTC.map(b => b.openTime));
  for (const asset of ['ADA', 'AAVE']) {
    const available = new Set(normalized[asset].map(b => b.openTime));
    for (const t of timestamps) if (!available.has(t)) timestamps.delete(t);
  }
  const aligned = [...timestamps].sort((a, b) => a - b);
  assert(aligned.length >= 3, 'insufficient_common_history');
  for (let i = 1; i < aligned.length; i++) assert(aligned[i] - aligned[i - 1] === stepMs, 'common_history_gap');
  const byTime = {};
  for (const asset of ASSETS) {
    const map = new Map(normalized[asset].map(b => [b.openTime, b]));
    byTime[asset] = aligned.map(t => map.get(t));
  }
  return Object.freeze({
    assets: ASSETS,
    stepMs,
    times: Object.freeze(aligned),
    alignedBars: byTime,
    sourceCounts: Object.fromEntries(ASSETS.map(a => [a, normalized[a].length]))
  });
}

function average(values) {
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

// Fixed public deterministic research strategies; not trained models.
// The policy receives only bars that had CLOSED as of the decision time.
export function createSmaPolicy({ fast = 7, slow = 30 } = {}) {
  assert(Number.isInteger(fast) && Number.isInteger(slow) && fast >= 2 && slow > fast && slow <= 365, 'invalid_sma_period');
  return Object.freeze({
    id: 'sma_' + fast + '_' + slow,
    decide({ history, units }) {
      if (history.length < slow) return 'HOLD';
      const closes = history.map(x => x.close);
      const fastMean = average(closes.slice(-fast));
      const slowMean = average(closes.slice(-slow));
      const latest = closes.at(-1);
      if (units <= 1e-12 && latest > fastMean && fastMean > slowMean) return 'BUY';
      if (units > 1e-12 && (fastMean < slowMean || latest < slowMean)) return 'SELL';
      return 'HOLD';
    }
  });
}

function portfolioValue(cash, positions, prices) {
  return cash + ASSETS.reduce((sum, a) => sum + positions[a] * prices[a], 0);
}
function maxDrawdown(curve) {
  let peak = 0, worst = 0;
  for (const item of curve) {
    peak = Math.max(peak, item.equityUsd);
    if (peak > 0) worst = Math.min(worst, (item.equityUsd / peak - 1) * 100);
  }
  return round(worst, 4);
}

function simulate(validated, { policy, initialCashUsd, feeBps, slippageBps, maxAssetWeight, maxTotalExposure, orderFraction, baseline }) {
  const cashStart = initialCashUsd;
  const positions = Object.fromEntries(ASSETS.map(a => [a, 0]));
  let cash = cashStart;
  let paidFeesUsd = 0;
  const fills = [], decisions = [], curve = [];
  let pending = [];

  function fill(asset, side, price, t, budget = null) {
    const fee = feeBps / 10_000, slip = slippageBps / 10_000;
    const effective = price * (side === 'BUY' ? (1 + slip) : (1 - slip));
    assert(effective > 0, 'invalid_fill_price');
    if (side === 'BUY') {
      const spend = Math.min(cash, Math.max(0, budget ?? 0));
      if (spend < 0.01) return;
      const notional = spend / (1 + fee);
      const units = notional / effective;
      cash -= spend;
      positions[asset] += units;
      paidFeesUsd += spend - notional;
      fills.push({ asset, side, at: new Date(t).toISOString(), price: round(effective), units: round(units, 12), cashChangeUsd: round(-spend), feeUsd: round(spend - notional, 6), simulated: true });
    } else {
      const units = positions[asset];
      if (units <= 1e-12) return;
      const gross = units * effective;
      const feeAmount = gross * fee;
      cash += gross - feeAmount;
      positions[asset] = 0;
      paidFeesUsd += feeAmount;
      fills.push({ asset, side, at: new Date(t).toISOString(), price: round(effective), units: round(units, 12), cashChangeUsd: round(gross - feeAmount), feeUsd: round(feeAmount, 6), simulated: true });
    }
  }

  for (let i = 0; i < validated.times.length; i++) {
    const t = validated.times[i];
    const today = Object.fromEntries(ASSETS.map(a => [a, validated.alignedBars[a][i]]));
    const openPrices = Object.fromEntries(ASSETS.map(a => [a, today[a].open]));
    const closePrices = Object.fromEntries(ASSETS.map(a => [a, today[a].close]));

    // Static HOLD baseline starts pre-committed, filled at first open.
    if (baseline === 'hold' && i === 0) {
      const allocation = initialCashUsd * maxTotalExposure / ASSETS.length;
      for (const asset of ASSETS) fill(asset, 'BUY', today[asset].open, t, allocation);
    }

    // An action decided at end of the previous bar can fill at TODAY's open,
    // never at the close that created the signal.
    for (const action of pending.filter(p => p.side === 'SELL').sort((a, b) => a.asset.localeCompare(b.asset))) {
      fill(action.asset, 'SELL', today[action.asset].open, t);
    }
    for (const action of pending.filter(p => p.side === 'BUY').sort((a, b) => a.asset.localeCompare(b.asset))) {
      const equity = portfolioValue(cash, positions, openPrices);
      const exposure = ASSETS.reduce((s, a) => s + positions[a] * openPrices[a], 0);
      const currentAssetValue = positions[action.asset] * openPrices[action.asset];
      const budget = Math.max(0, Math.min(
        cash, cash * orderFraction,
        equity * maxAssetWeight - currentAssetValue,
        equity * maxTotalExposure - exposure
      ));
      fill(action.asset, 'BUY', today[action.asset].open, t, budget);
    }
    pending = [];
    const currentEquity = portfolioValue(cash, positions, closePrices);
    assert(currentEquity > 0 && cash > -0.00001, 'negative_cash_or_equity');
    curve.push({ at: new Date(today.BTC.closeTime).toISOString(), equityUsd: round(currentEquity, 6), cashUsd: round(Math.max(0, cash), 6) });

    if (baseline) continue;

    for (const asset of ASSETS) {
      const history = Object.freeze(validated.alignedBars[asset].slice(0, i + 1));
      const lastClosed = history.at(-1);
      // Only a built-in policy function, provided with an immutable history prefix.
      const decision = policy.decide(Object.freeze({
        asset, history, units: positions[asset],
        equityUsd: currentEquity, cashUsd: cash,
        observedThrough: lastClosed.closeTime
      }));
      assert(['BUY', 'SELL', 'HOLD'].includes(decision), 'unsupported_action');
      if (decision !== 'HOLD') {
        decisions.push({
          asset, action: decision, observedThrough: new Date(lastClosed.closeTime).toISOString(),
          earliestFill: i + 1 < validated.times.length ? new Date(validated.times[i + 1]).toISOString() : null,
          inputBars: history.length
        });
        if (i + 1 < validated.times.length) pending.push({ asset, side: decision });
      }
    }
  }

  const final = curve.at(-1).equityUsd;
  return {
    policyId: baseline || policy.id,
    initialUsd: cashStart, finalUsd: round(final, 6),
    netReturnPct: round((final / cashStart - 1) * 100, 4),
    maxDrawdownPct: maxDrawdown(curve),
    paidFeesUsd: round(paidFeesUsd, 6),
    fills: fills.length, decisions: decisions.length,
    finalCashUsd: round(cash, 6),
    finalPositions: Object.fromEntries(ASSETS.map(a => [a, round(positions[a], 12)])),
    executionEnabled: false,
    audit: { decisions, fills },
    equityCurve: curve
  };
}

// Returns auditable, self-contained result. No live venue, no external calls,
// no policy promotion; repeated identical inputs imply identical result hash.
export function runTimeMachine({
  series, stepMs = DAY_MS, policy = createSmaPolicy(),
  initialCashUsd = 10_000, feeBps = 10, slippageBps = 5,
  maxAssetWeight = 0.4, maxTotalExposure = 0.8, orderFraction = 0.4
} = {}) {
  assert(isFinitePositive(initialCashUsd), 'invalid_initial_capital');
  assert([feeBps, slippageBps].every(x => Number.isFinite(x) && x >= 0 && x <= 1000), 'invalid_costs');
  assert(maxAssetWeight > 0 && maxAssetWeight <= 1, 'invalid_asset_weight');
  assert(maxTotalExposure > 0 && maxTotalExposure <= 1, 'invalid_exposure');
  assert(orderFraction > 0 && orderFraction <= 1, 'invalid_order_fraction');
  assert(policy && typeof policy.decide === 'function' && typeof policy.id === 'string', 'invalid_policy');
  const validated = validateSeries(series, { stepMs });
  const cfg = { policy, initialCashUsd, feeBps, slippageBps, maxAssetWeight, maxTotalExposure, orderFraction };
  const candidate = simulate(validated, { ...cfg, baseline: null });
  const hold = simulate(validated, { ...cfg, baseline: 'hold' });
  const cash = simulate(validated, { ...cfg, baseline: 'cash' });
  const report = {
    schema: 'shadow_time_machine_v0.1',
    mode: 'OFFLINE_ONLY', syntheticResults: false,
    policyId: policy.id, assets: [...ASSETS], intervalMs: stepMs,
    bars: validated.times.length,
    from: new Date(validated.times[0]).toISOString(),
    to: new Date(validated.times.at(-1)).toISOString(),
    dataHash: canonicalHash(validated.alignedBars),
    assumptions: { initialCashUsd, feeBps, slippageBps, maxAssetWeight, maxTotalExposure, orderFraction, fills: 'next_bar_open', quoteCurrency: 'USDT_proxy_not_Bitso_USDC', venue: 'historical_input_venue_only' },
    candidate, benchmarks: { hold, cash },
    alphaVsHoldPp: round(candidate.netReturnPct - hold.netReturnPct, 4),
    executedRealOrders: 0, executionEnabled: false, policyPromoted: false,
    warning: 'Research simulation. Missing macro/news and real Bitso spreads; no performance claim or live execution.'
  };
  report.runHash = canonicalHash(report);
  return report;
}

export const TIME_MACHINE_ASSETS = ASSETS;
export const TIME_MACHINE_DAY_MS = DAY_MS;
