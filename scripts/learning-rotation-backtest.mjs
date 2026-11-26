#!/usr/bin/env node
// Asset-agnostic rotation backtest (research only; never trades).
// Question: can Shadow "read the market" and hold WHATEVER is trending, instead of
// fixed coins, and beat holding? Policy menu is FIXED here, declared before results.
// Walk-forward: choose the best policy using only 2021-07..2024-12, then report it
// untouched on 2025-01..end. Costs 0.42% per side (Bitso taker + half spread).
// Signals use the close of day t; the new weights earn from day t+1 on.
// Limitations: the universe is today's large coins (survivorship bias); one market history.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const COST = 0.0042, SMA = 200, MOM = 90, DAY = 86_400_000;
const SELECT = ['2021-07-01', '2024-12-31'], TEST_FROM = '2025-01-01';

export function loadCloses({ manifest, root }) {
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const series = {};
  for (const [asset, meta] of Object.entries(m.assets)) {
    const rows = fs.readFileSync(path.join(root, meta.file), 'utf8').trim().split('\n');
    const map = new Map();
    for (const r of rows) {
      const c = r.split(','); let t = Number(c[0]); if (!Number.isFinite(t)) continue;
      if (t > 1e14) t = Math.floor(t / 1000); // Binance spot data is in microseconds since 2025
      map.set(new Date(t).toISOString().slice(0, 10), Number(c[4]));
    }
    series[asset] = map;
  }
  return series;
}

export function buildPanel(series) {
  const days = [...new Set(Object.values(series).flatMap(m => [...m.keys()]))].sort();
  const assets = Object.keys(series);
  return { days, assets, px: assets.map(a => days.map(d => series[a].get(d) ?? null)) };
}

function smaAt(arr, i, n) { if (i + 1 < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) { if (arr[k] == null) return null; s += arr[k]; } return s / n; }

// --- Fixed policy menu (weights decided at close of day i, using data <= i).
export const POLICIES = {
  HOLD_BTC: { rebalance: 'never', fn: ({ assets }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' ? 1 : 0])) },
  HOLD_EQUAL: { rebalance: 'never', fn: ({ assets, live }) => { const l = assets.filter(live); return Object.fromEntries(assets.map(a => [a, l.includes(a) ? 1 / l.length : 0])); } },
  TREND_EQUAL: { rebalance: 'daily', fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, above(a) ? 1 / assets.length : 0])) },
  MANDATE_BTC_ADA_TREND: { rebalance: 'daily', fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' ? (above('BTC') ? 0.3 : 0) : a === 'ADA' ? (above('ADA') ? 0.7 : 0) : 0])) },
  ROTATE_TOP1: { rebalance: 'weekly', fn: ctx => topK(ctx, 1) },
  ROTATE_TOP2: { rebalance: 'weekly', fn: ctx => topK(ctx, 2) },
  ROTATE_TOP3: { rebalance: 'weekly', fn: ctx => topK(ctx, 3) }
};
// POST-HOC DIAGNOSTICS (added after seeing the first run; NEVER eligible for selection):
// measure how much of the BTC/ADA mandate loss is false-signal churn around the SMA200.
export const DIAGNOSTICS = {
  DIAG_MANDATE_BAND3: { rebalance: 'daily', band: 0.03, fn: ({ assets, aboveBand }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' ? (aboveBand('BTC') ? 0.3 : 0) : a === 'ADA' ? (aboveBand('ADA') ? 0.7 : 0) : 0])) },
  DIAG_ADA_TREND: { rebalance: 'daily', fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, a === 'ADA' && above('ADA') ? 1 : 0])) },
  DIAG_BTC_TREND: { rebalance: 'daily', fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' && above('BTC') ? 1 : 0])) },
  DIAG_HOLD_ADA: { rebalance: 'never', fn: ({ assets }) => Object.fromEntries(assets.map(a => [a, a === 'ADA' ? 1 : 0])) }
};
function topK({ assets, above, mom }, k) {
  const ranked = assets.filter(a => above(a) && mom(a) != null && mom(a) > 0).sort((x, y) => mom(y) - mom(x)).slice(0, k);
  return Object.fromEntries(assets.map(a => [a, ranked.includes(a) ? 1 / k : 0])); // unfilled slots stay in cash
}

export function simulate(panel, policyName, from, to) {
  const { days, assets, px } = panel, pol = POLICIES[policyName] || DIAGNOSTICS[policyName];
  const held = {};
  const idx = a => assets.indexOf(a);
  let i0 = days.findIndex(d => d >= from); let i1 = days.length - 1; while (days[i1] > to) i1--;
  let w = Object.fromEntries(assets.map(a => [a, 0])), equity = 1, peak = 1, maxDd = 0, turnover = 0, trades = 0;
  const curve = [];
  for (let i = i0; i <= i1; i++) {
    // 1) earn today's return with yesterday's weights
    if (i > i0) {
      let r = 0, wsum = 0;
      for (const a of assets) { const p0 = px[idx(a)][i - 1], p1 = px[idx(a)][i]; if (w[a] > 0 && p0 && p1) { r += w[a] * (p1 / p0 - 1); wsum += w[a]; } }
      // drift weights
      const grown = Object.fromEntries(assets.map(a => { const p0 = px[idx(a)][i - 1], p1 = px[idx(a)][i]; return [a, w[a] > 0 && p0 && p1 ? w[a] * p1 / p0 : w[a]]; }));
      equity *= 1 + r; const tot = Object.values(grown).reduce((s, x) => s + x, 0) + (1 - wsum);
      w = Object.fromEntries(assets.map(a => [a, tot > 0 ? grown[a] / tot : 0]));
    }
    peak = Math.max(peak, equity); maxDd = Math.max(maxDd, 1 - equity / peak);
    curve.push([days[i], equity]);
    // 2) decide new weights at today's close
    const dow = new Date(days[i] + 'T00:00:00Z').getUTCDay();
    const due = i === i0 || pol.rebalance === 'daily' || (pol.rebalance === 'weekly' && dow === 1);
    if (!due) continue;
    const ctx = { assets,
      live: a => px[idx(a)][i] != null,
      above: a => { const s = smaAt(px[idx(a)], i, SMA); return s != null && px[idx(a)][i] > s; },
      aboveBand: a => { const s = smaAt(px[idx(a)], i, SMA), p = px[idx(a)][i]; if (s == null) return false;
        if (p > s * (1 + (pol.band || 0))) held[a] = true; else if (p < s * (1 - (pol.band || 0))) held[a] = false; return Boolean(held[a]); },
      mom: a => { const p = px[idx(a)]; return i >= MOM && p[i] && p[i - MOM] ? p[i] / p[i - MOM] - 1 : null; } };
    const target = pol.fn(ctx);
    let tv = 0; for (const a of assets) tv += Math.abs((target[a] || 0) - w[a]);
    if (tv > 1e-9 && (pol.rebalance !== 'never' || i === i0)) {
      if (pol.rebalance === 'daily' && tv < 0.02) continue; // ignore drift-only rebalances
      equity *= 1 - COST * tv; turnover += tv; trades++;
      w = Object.fromEntries(assets.map(a => [a, target[a] || 0]));
    }
  }
  const yrs = (Date.parse(days[i1]) - Date.parse(days[i0])) / (365.25 * DAY);
  const byYear = {};
  for (let k = 0; k < curve.length; k++) { const y = curve[k][0].slice(0, 4); byYear[y] ??= { start: k ? curve[k - 1][1] : 1 }; byYear[y].end = curve[k][1]; }
  return { policy: policyName, from: days[i0], to: days[i1], returnPct: r1(100 * (equity - 1)), cagrPct: r1(100 * (equity ** (1 / yrs) - 1)), maxDdPct: r1(100 * maxDd),
    score: r1(100 * (equity - 1) - 0.5 * 100 * maxDd), turnover: r1(turnover), rebalances: trades,
    byYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, r1(100 * (v.end / v.start - 1))])) };
}
const r1 = x => Math.round(x * 10) / 10;

if (import.meta.url === `file://${process.argv[1]}` && args.eval) {
  // Backcast mode: score the FIXED menu on a window never used for selection (e.g. 2018-2020).
  const [from, to] = args.eval.split('..');
  const panel = buildPanel(loadCloses({ manifest: args.manifest, root: args.root }));
  const row = r => `${r.policy.padEnd(22)} trades ${String(r.rebalances).padStart(3)}  ret ${String(r.returnPct).padStart(7)}%  cagr ${String(r.cagrPct).padStart(6)}%  maxDD ${String(r.maxDdPct).padStart(5)}%  years ${JSON.stringify(r.byYear)}`;
  console.log(`== BACKCAST ${from}..${to} (universe ${panel.assets.join(',')}; selection was done on 2021-07..2024-12) ==`);
  const res = [...Object.keys(POLICIES), ...Object.keys(DIAGNOSTICS)].map(p => simulate(panel, p, from, to));
  res.forEach(r => console.log(row(r)));
  console.log('SHADOW_BACKCAST=' + JSON.stringify(res.map(r => ({ p: r.policy, ret: r.returnPct, dd: r.maxDdPct, years: r.byYear }))));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const panel = buildPanel(loadCloses({ manifest: args.manifest, root: args.root }));
  const last = panel.days[panel.days.length - 1];
  const select = Object.keys(POLICIES).map(p => simulate(panel, p, ...SELECT)).sort((a, b) => b.score - a.score);
  const chosen = select[0].policy;
  const test = Object.keys(POLICIES).map(p => simulate(panel, p, TEST_FROM, last));
  const full = Object.keys(POLICIES).map(p => simulate(panel, p, SELECT[0], last));
  const out = { version: 'shadow-rotation-backtest-v0.1', universe: panel.assets, costPerSide: COST, smaDays: SMA, momentumDays: MOM,
    selectWindow: SELECT, testFrom: TEST_FROM, dataEnd: last, chosenOnSelectWindow: chosen,
    chosenInTest: test.find(t => t.policy === chosen), select, test, full, realOrders: 0 };
  fs.mkdirSync('artifacts/rotation', { recursive: true });
  fs.writeFileSync('artifacts/rotation/rotation-backtest.json', JSON.stringify(out, null, 2));
  const row = r => `${r.policy.padEnd(22)} trades ${String(r.rebalances).padStart(3)}  ret ${String(r.returnPct).padStart(7)}%  cagr ${String(r.cagrPct).padStart(6)}%  maxDD ${String(r.maxDdPct).padStart(5)}%  score ${r.score}  years ${JSON.stringify(r.byYear)}`;
  console.log('== SELECT (2021-07..2024-12) =='); select.forEach(r => console.log(row(r)));
  console.log(`== CHOSEN: ${chosen} ==`); console.log('== TEST (2025-01..' + last + ') =='); test.forEach(r => console.log(row(r)));
  console.log('== FULL =='); full.forEach(r => console.log(row(r)));
  console.log('== POST-HOC DIAGNOSTICS (not eligible for selection) ==');
  for (const d of Object.keys(DIAGNOSTICS)) { console.log('  select ' + row(simulate(panel, d, ...SELECT))); console.log('  test   ' + row(simulate(panel, d, TEST_FROM, last))); }
  console.log('SHADOW_ROTATION_BACKTEST=' + JSON.stringify({ chosen, test: out.chosenInTest, realOrders: 0 }));
}
