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
// RISK VARIANTS of BTC trend, PRE-DECLARED 2026-11-25 before any result (goal: max drawdown <= 40%
// in 2018-20, 2021-24 and 2025-26). Not eligible for the original selection.
const q25 = w => Math.round(w * 4) / 4;
export const RISK_VARIANTS = {
  BTC_TREND: { rebalance: 'daily', fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' && above('BTC') ? 1 : 0])) },
  BTC_TREND_HALF: { rebalance: 'daily', driftTol: 0.15, fn: ({ assets, above }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' && above('BTC') ? 0.5 : 0])) },
  BTC_TREND_VOLTARGET40: { rebalance: 'daily', driftTol: 0.15, fn: ({ assets, above, vol30 }) => { const v = vol30('BTC');
    const w = above('BTC') && v > 0 ? q25(Math.min(1, 0.40 / v)) : 0; return Object.fromEntries(assets.map(a => [a, a === 'BTC' ? w : 0])); } },
  BTC_TREND_FAST_EXIT: { rebalance: 'daily', fn: ({ assets, above, above50 }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' && above('BTC') && above50('BTC') ? 1 : 0])) },
  HOLD_BTC: { rebalance: 'never', fn: ({ assets }) => Object.fromEntries(assets.map(a => [a, a === 'BTC' ? 1 : 0])) }
};

// STOCK RULES, PRE-DECLARED 2026-11-26 before any stock result (owner asked whether falling quality
// companies are an entry). Windows: 2007-09 (GFC), 2010-19, 2020-26. Benchmarks: HOLD_SPY, HOLD_QQQ.
const one = (assets, a, w = 1) => Object.fromEntries(assets.map(x => [x, x === a ? w : 0]));
export const STOCK_RULES = {
  HOLD_SPY: { rebalance: 'never', fn: ({ assets }) => one(assets, 'SPY') },
  HOLD_QQQ: { rebalance: 'never', fn: ({ assets }) => one(assets, 'QQQ') },
  SPY_TREND: { rebalance: 'daily', fn: ({ assets, above }) => one(assets, 'SPY', above('SPY') ? 1 : 0) },
  QQQ_TREND: { rebalance: 'daily', fn: ({ assets, above }) => one(assets, 'QQQ', above('QQQ') ? 1 : 0) },
  SPY_FAST_EXIT: { rebalance: 'daily', fn: ({ assets, above, above50 }) => one(assets, 'SPY', above('SPY') && above50('SPY') ? 1 : 0) },
  // "Buy the correction": enter SPY when it is >= 10% below its 1-year high; hold 252 trading days; else cash.
  SPY_BUY_CORRECTION: { rebalance: 'daily', fn: ({ assets, dd252, i, state }) => {
    if (state.until != null && i < state.until) return one(assets, 'SPY');
    state.until = null; const d = dd252('SPY');
    if (d != null && d >= 0.10) { state.until = i + 252; return one(assets, 'SPY'); }
    return one(assets, 'SPY', 0); } },
  // Same, on falling megacaps: each Monday hold up to 3 megacaps that are >= 20% below their 1-year high
  // but back above their SMA50 (stabilizing), equal weight; else cash.
  MEGACAP_DIP_STABILIZED: { rebalance: 'weekly', fn: ({ assets, dd252, above50 }) => {
    const mc = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META'].filter(a => assets.includes(a));
    const pick = mc.filter(a => (dd252(a) ?? 0) >= 0.20 && above50(a)).slice(0, 3);
    return Object.fromEntries(assets.map(a => [a, pick.includes(a) ? 1 / 3 : 0])); } },
  ROTATE_TOP1: { rebalance: 'weekly', fn: ctx => topK(ctx, 1) }
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
  const { days, assets, px } = panel, pol = POLICIES[policyName] || DIAGNOSTICS[policyName] || RISK_VARIANTS[policyName] || STOCK_RULES[policyName];
  const held = {};
  const idx = a => assets.indexOf(a);
  let i0 = days.findIndex(d => d >= from); let i1 = days.length - 1; while (days[i1] > to) i1--;
  let w = Object.fromEntries(assets.map(a => [a, 0])), equity = 1, peak = 1, maxDd = 0, turnover = 0, trades = 0;
  const curve = [], decisions = [], polState = {};
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
      mom: a => { const p = px[idx(a)]; return i >= MOM && p[i] && p[i - MOM] ? p[i] / p[i - MOM] - 1 : null; },
      i, state: polState,
      dd252: a => { const p = px[idx(a)]; if (i < 251 || !p[i]) return null; let m = 0; for (let k = i - 251; k <= i; k++) if (p[k] > m) m = p[k]; return 1 - p[i] / m; },
      above50: a => { const s50 = smaAt(px[idx(a)], i, 50); return s50 != null && px[idx(a)][i] > s50; },
      vol30: a => { const p = px[idx(a)]; if (i < 31) return null; const r = [];
        for (let k = i - 29; k <= i; k++) { if (!p[k] || !p[k - 1]) return null; r.push(Math.log(p[k] / p[k - 1])); }
        const m = r.reduce((x, y) => x + y, 0) / r.length; return Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(365); } };
    const target = pol.fn(ctx);
    let tv = 0; for (const a of assets) tv += Math.abs((target[a] || 0) - w[a]);
    if (tv > 1e-9 && (pol.rebalance !== 'never' || i === i0)) {
      if (pol.rebalance === 'daily' && tv < (pol.driftTol ?? 0.02)) continue; // ignore drift-only rebalances
      equity *= 1 - COST * tv; turnover += tv; trades++;
      decisions.push({ i, day: days[i], from: { ...w }, to: Object.fromEntries(assets.map(a => [a, target[a] || 0])), tv });
      w = Object.fromEntries(assets.map(a => [a, target[a] || 0]));
    }
  }
  const alloc = (wv, i, j) => { let r = 0; for (const a of assets) { const p0 = px[idx(a)][i], p1 = px[idx(a)][j]; if (wv[a] > 0 && p0 && p1) r += wv[a] * (p1 / p0 - 1); } return r; };
  const graded = decisions.filter(d => d.i > i0 && d.i + 30 < days.length).map(d => {
    const edge = alloc(d.to, d.i, d.i + 30) - alloc(d.from, d.i, d.i + 30) - COST * d.tv; return { day: d.day, edge, hit: edge > 0 }; });
  const decisionScore = { graded: graded.length, hits: graded.filter(g => g.hit).length,
    hitPct: graded.length ? r1(100 * graded.filter(g => g.hit).length / graded.length) : null,
    avgEdgePct: graded.length ? r1(100 * graded.reduce((x, g) => x + g.edge, 0) / graded.length) : null };
  const yrs = (Date.parse(days[i1]) - Date.parse(days[i0])) / (365.25 * DAY);
  const byYear = {};
  for (let k = 0; k < curve.length; k++) { const y = curve[k][0].slice(0, 4); byYear[y] ??= { start: k ? curve[k - 1][1] : 1 }; byYear[y].end = curve[k][1]; }
  return { policy: policyName, from: days[i0], to: days[i1], returnPct: r1(100 * (equity - 1)), cagrPct: r1(100 * (equity ** (1 / yrs) - 1)), maxDdPct: r1(100 * maxDd),
    score: r1(100 * (equity - 1) - 0.5 * 100 * maxDd), turnover: r1(turnover), rebalances: trades, decisionScore,
    byYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, r1(100 * (v.end / v.start - 1))])) };
}
const r1 = x => Math.round(x * 10) / 10;

if (import.meta.url === `file://${process.argv[1]}` && args.stocks) {
  const pnl = buildPanel(loadCloses({ manifest: `${args.stocks}/manifest.json`, root: args.stocks }));
  const last = pnl.days[pnl.days.length - 1];
  const windows = [['2007-06-01', '2009-12-31'], ['2010-01-01', '2019-12-31'], ['2020-01-01', last]];
  console.log(`== STOCK RULES (pre-declared 2026-11-26) data ${pnl.days[0]}..${last} universe ${pnl.assets.join(',')} ==`);
  const res = {};
  for (const r of Object.keys(STOCK_RULES)) {
    res[r] = windows.map(([f, t]) => { const x = simulate(pnl, r, f, t); return { w: `${f.slice(0, 4)}-${t.slice(0, 4)}`, ret: x.returnPct, cagr: x.cagrPct, dd: x.maxDdPct, trades: x.rebalances, ds: x.decisionScore }; });
    console.log(`${r.padEnd(24)} ${res[r].map(w => `${w.w}: ret ${w.ret}% cagr ${w.cagr}% dd ${w.dd}% trades ${w.trades} hits ${w.ds.hits}/${w.ds.graded}`).join(' | ')}`);
  }
  // Where are we now? Current postures for the owner (information only).
  const i = pnl.days.length - 1, now = {};
  for (const a of pnl.assets) { const p = pnl.px[pnl.assets.indexOf(a)]; let s200 = 0, s50 = 0, m = 0;
    for (let k = i - 199; k <= i; k++) s200 += p[k]; for (let k = i - 49; k <= i; k++) s50 += p[k]; for (let k = i - 251; k <= i; k++) m = Math.max(m, p[k]);
    now[a] = { close: p[i], vsSma200Pct: r1(100 * (p[i] / (s200 / 200) - 1)), vsSma50Pct: r1(100 * (p[i] / (s50 / 50) - 1)), offHighPct: r1(100 * (p[i] / m - 1)) }; }
  console.log('NOW ' + last + ' ' + JSON.stringify(now));
  console.log('SHADOW_STOCKS=' + JSON.stringify(res));
} else if (import.meta.url === `file://${process.argv[1]}` && args.variants) {
  // --variants=backcastManifest:root,mainManifest:root -> three windows, BTC only.
  const [bc, mn] = args.variants.split(',').map(x => x.split(':'));
  const pb = buildPanel(loadCloses({ manifest: bc[0], root: bc[1] })), pm = buildPanel(loadCloses({ manifest: mn[0], root: mn[1] }));
  const windows = [['2018-03-01', '2020-12-31', pb], ['2021-07-01', '2024-12-31', pm], ['2025-01-01', pm.days[pm.days.length - 1], pm]];
  const out = {}, dec = {};
  for (const v of [...Object.keys(RISK_VARIANTS), 'ROTATE_TOP1']) {
    out[v] = windows.map(([f, t, p]) => { const r = simulate(p, v, f, t); return { window: `${f.slice(0, 4)}-${t.slice(0, 4)}`, ret: r.returnPct, dd: r.maxDdPct, calmar: r.maxDdPct ? Math.round(r.cagrPct / r.maxDdPct * 100) / 100 : null, trades: r.rebalances, years: r.byYear, ds: r.decisionScore }; });
    const g = out[v].reduce((a, w) => ({ graded: a.graded + w.ds.graded, hits: a.hits + w.ds.hits, edgeSum: a.edgeSum + (w.ds.avgEdgePct || 0) * w.ds.graded }), { graded: 0, hits: 0, edgeSum: 0 });
    dec[v] = { graded: g.graded, hits: g.hits, hitPct: g.graded ? Math.round(1000 * g.hits / g.graded) / 10 : null, avgEdgePct: g.graded ? Math.round(10 * g.edgeSum / g.graded) / 10 : null,
      byWindow: out[v].map(w => `${w.window}: ${w.ds.hits}/${w.ds.graded} (${w.ds.hitPct}%, edge ${w.ds.avgEdgePct}%)`),
      c5Historical: g.graded >= 10 && g.hits / g.graded >= 0.55 ? 10 : 0 };
    const worst = Math.max(...out[v].map(w => w.dd));
    console.log(`${v.padEnd(22)} worstDD ${String(worst).padStart(5)}%  ${out[v].map(w => `${w.window}: ret ${w.ret}% dd ${w.dd}% calmar ${w.calmar} trades ${w.trades}`).join(' | ')}`);
  }
  console.log('== HISTORICAL DECISION GRADING (30d vs not acting, net of switch cost; pass = >=10 decisions and >=55% hits) ==');
  for (const [v, d] of Object.entries(dec)) console.log(`${v.padEnd(22)} ${d.hits}/${d.graded} = ${d.hitPct}%  avgEdge ${d.avgEdgePct}%  C5hist ${d.c5Historical}  | ${d.byWindow.join(' | ')}`);
  console.log('SHADOW_RISK_VARIANTS=' + JSON.stringify(out));
} else if (import.meta.url === `file://${process.argv[1]}` && args.eval) {
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
