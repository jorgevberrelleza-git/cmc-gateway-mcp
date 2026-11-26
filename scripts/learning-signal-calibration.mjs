#!/usr/bin/env node
// Signal calibration + extra information sources (research only; never trades).
// C7: when the signal "anticipates" a direction, how often is it right 30 days later,
// compared with the base rate (how often the market simply went up)? Also measures
// whether two extra public sources add information: the Crypto Fear & Greed index and
// BTC perpetual funding rates. Windows: select 2021-07..2024-12, test 2025-01..end.
// Overlapping 30-day windows inflate apparent precision, so a non-overlapping sample
// (every 30th day) is reported too.
import fs from 'node:fs';
import { loadCloses, buildPanel } from './learning-rotation-backtest.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const SMA = 200, H = 30, MOM = 90;
const WIN = { select: ['2021-07-01', '2024-12-31'], test: ['2025-01-01', '9999-12-31'] };
const pct = x => x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 10;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;

const panel = buildPanel(loadCloses({ manifest: args.manifest, root: args.root }));
const { days, assets, px } = panel;
const sma = (p, i) => { if (i + 1 < SMA) return null; let s = 0; for (let k = i - SMA + 1; k <= i; k++) { if (p[k] == null) return null; s += p[k]; } return s / SMA; };
const inWin = (d, w) => d >= WIN[w][0] && d <= WIN[w][1];

function calibrate(filter = () => true) {
  const out = {};
  for (const w of ['select', 'test']) {
    const rows = [];
    for (let ai = 0; ai < assets.length; ai++) {
      const p = px[ai];
      for (let i = SMA; i + H < days.length; i++) {
        if (!inWin(days[i], w) || p[i] == null || p[i + H] == null) continue;
        const s = sma(p, i); if (s == null) continue;
        const on = p[i] > s, fwd = p[i + H] / p[i] - 1;
        if (!filter({ asset: assets[ai], i, on })) continue;
        rows.push({ asset: assets[ai], i, on, fwd });
      }
    }
    const sum = rs => {
      const on = rs.filter(r => r.on), off = rs.filter(r => !r.on);
      const hit = rs.filter(r => (r.on && r.fwd > 0) || (!r.on && r.fwd <= 0)).length / rs.length;
      const base = rs.filter(r => r.fwd > 0).length / rs.length;
      const nonOv = rs.filter(r => r.i % H === 0);
      const hitNO = nonOv.filter(r => (r.on && r.fwd > 0) || (!r.on && r.fwd <= 0)).length / nonOv.length;
      return { n: rs.length, nNonOverlap: nonOv.length, hitPct: pct(hit), hitNonOverlapPct: pct(hitNO), baseUpPct: pct(base),
        avgFwdOnPct: pct(mean(on.map(r => r.fwd))), avgFwdOffPct: pct(mean(off.map(r => r.fwd))), daysOnPct: pct(on.length / rs.length) };
    };
    out[w] = { all: sum(rows), byAsset: Object.fromEntries(assets.map(a => [a, sum(rows.filter(r => r.asset === a))])) };
  }
  return out;
}

// Rotation pick quality: each Monday, did the pick beat the equal-weight universe and cash over the next 7 days?
function rotationPicks() {
  const out = {};
  for (const w of ['select', 'test']) {
    let n = 0, beatEw = 0, beatCash = 0, cashWeeks = 0, cashRight = 0; const edge = [];
    for (let i = MOM; i + 7 < days.length; i++) {
      if (!inWin(days[i], w) || new Date(days[i] + 'T00:00:00Z').getUTCDay() !== 1) continue;
      const cand = assets.map((a, ai) => ({ a, ai, p: px[ai][i], s: sma(px[ai], i), m: px[ai][i] && px[ai][i - MOM] ? px[ai][i] / px[ai][i - MOM] - 1 : null }))
        .filter(x => x.p && x.s && x.p > x.s && x.m > 0).sort((x, y) => y.m - x.m);
      const f7 = ai => px[ai][i + 7] && px[ai][i] ? px[ai][i + 7] / px[ai][i] - 1 : null;
      const ew = mean(assets.map((_, ai) => f7(ai)).filter(x => x != null));
      if (!cand.length) { cashWeeks++; if (ew <= 0) cashRight++; continue; }
      const r = f7(cand[0].ai); if (r == null) continue;
      n++; if (r > ew) beatEw++; if (r > 0) beatCash++; edge.push(r - ew);
    }
    out[w] = { picks: n, beatEqualWeightPct: pct(beatEw / n), positivePct: pct(beatCash / n), avgEdgeVsEqualWeightPct: pct(mean(edge)),
      cashWeeks, cashWeeksMarketFellPct: pct(cashRight / cashWeeks) };
  }
  return out;
}

// Extra sources (BTC only): average forward 30-day return by bucket, inside each posture.
function sourceStudy(series, buckets, label) {
  const bi = assets.indexOf('BTC'), p = px[bi], out = {};
  for (const w of ['select', 'test']) {
    const rows = [];
    for (let i = SMA; i + H < days.length; i++) {
      if (!inWin(days[i], w)) continue;
      const v = series.get(days[i]), s = sma(p, i);
      if (v == null || s == null || p[i] == null || p[i + H] == null) continue;
      rows.push({ on: p[i] > s, v, fwd: p[i + H] / p[i] - 1, i });
    }
    out[w] = {};
    for (const [name, test] of buckets) for (const on of [true, false]) {
      const rs = rows.filter(r => r.on === on && test(r.v));
      out[w][`${on ? 'ON' : 'OFF'}:${name}`] = { n: rs.length, nNonOverlap: rs.filter(r => r.i % H === 0).length, avgFwd30Pct: pct(mean(rs.map(r => r.fwd))), upPct: pct(rs.filter(r => r.fwd > 0).length / rs.length) };
    }
  }
  return { source: label, ...out };
}

const result = { version: 'shadow-signal-calibration-v0.1', horizonDays: H, dataEnd: days[days.length - 1], universe: assets,
  sma200: calibrate(), rotationPicks: rotationPicks() };

if (args.extra) {
  const fng = new Map(JSON.parse(fs.readFileSync(`${args.extra}/fear_greed.json`, 'utf8')).map(x => [x.day, x.value]));
  result.fearGreed = sourceStudy(fng, [['extremeFear<25', v => v < 25], ['fear25-49', v => v >= 25 && v < 50], ['greed50-74', v => v >= 50 && v < 75], ['extremeGreed>=75', v => v >= 75]], 'alternative.me Fear & Greed');
  const fr = JSON.parse(fs.readFileSync(`${args.extra}/funding_btc.json`, 'utf8'));
  const byDay = new Map(); for (const r of fr) { const d = new Date(r.t).toISOString().slice(0, 10); const a = byDay.get(d) || []; a.push(r.rate); byDay.set(d, a); }
  // Rolling 7-day average funding, as an annualized percent (3 fundings/day).
  const dayList = [...byDay.keys()].sort(), daily = new Map(dayList.map(d => [d, mean(byDay.get(d))]));
  const roll = new Map(dayList.map((d, k) => [d, 100 * 3 * 365 * mean(dayList.slice(Math.max(0, k - 6), k + 1).map(x => daily.get(x)))]));
  result.funding = sourceStudy(roll, [['negative<0', v => v < 0], ['normal0-10', v => v >= 0 && v < 10], ['hot10-20', v => v >= 10 && v < 20], ['crowded>=20', v => v >= 20]], 'Binance BTCUSDT perp funding, 7d avg, annualized %');
}

fs.mkdirSync('artifacts/calibration', { recursive: true });
fs.writeFileSync('artifacts/calibration/signal-calibration.json', JSON.stringify(result, null, 2));
for (const [k, v] of Object.entries(result)) if (typeof v === 'object') console.log(`CALIBRATION_${k.toUpperCase()}=` + JSON.stringify(v));
