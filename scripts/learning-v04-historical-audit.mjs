// Offline, reproducible audit of the frozen v0.4 momentum votes and the
// pre-declared v0.7 trend filter against HOLD, with Bitso-like costs.
//
// Input: JSON file {"BTCUSDT":[{"t":<openTimeMs>,"c":<close>}, ...], ...}
// (daily closed candles; e.g. converted from the Time Machine's checksummed
// Binance Vision manifest). No network, no DB, no broker.
//
//   node scripts/learning-v04-historical-audit.mjs --input=daily.json [--start=2021-01-01]
import fs from 'node:fs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const input = arg('input');
if (!input) { console.error('usage: --input=daily.json [--start=YYYY-MM-DD]'); process.exit(2); }
const startMs = Date.parse(arg('start') || '2021-01-01');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const COSTS = [0.0042, 0.008];

const sg = (v, th) => v >= th ? 1 : v <= -th ? -1 : 0;
function v04(c, i, h) {
  if (i < 7) return null;
  const d = sg((c[i] / c[i - 1] - 1) * 100, 2), w = sg((c[i] / c[i - 7] - 1) * 100, 4);
  const s = h === 1 ? 2 * d + w : h === 3 ? d + 2 * w : 3 * w; // microstructure unavailable -> 0
  return s >= 3 ? 'UP' : s <= -3 ? 'DOWN' : 'ABSTAIN';
}
const sma = (c, i, n) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += c[j]; return s / n; };

function forecastSkill(c, i0, h) {
  let n = 0, hit = 0, up = 0, days = 0;
  for (let i = i0; i + h < c.length; i++) {
    days++;
    const s = v04(c, i, h);
    if (s !== 'UP' && s !== 'DOWN') continue;
    const act = c[i + h] > c[i] ? 'UP' : 'DOWN';
    n++; if (s === act) hit++; if (act === 'UP') up++;
  }
  const p = n ? hit / n : NaN;
  return { h, days, issued: n, coveragePct: +(100 * n / days).toFixed(1), hitPct: +(100 * p).toFixed(1),
    alwaysUpPct: +(100 * up / n).toFixed(1), zOverlapAdj: +((p - .5) / Math.sqrt(.25 / (n / h))).toFixed(2) };
}

function simulate(c, i0, wantInvested, cost) {
  let inv = wantInvested(i0, 1) ? 1 : 0, eq = 1, hold = 1, pk = 1, hpk = 1, dd = 0, hdd = 0, trades = 0;
  for (let i = i0; i < c.length; i++) {
    if (i > i0) { const r = c[i] / c[i - 1]; hold *= r; if (inv) eq *= r; }
    pk = Math.max(pk, eq); hpk = Math.max(hpk, hold);
    dd = Math.min(dd, eq / pk - 1); hdd = Math.min(hdd, hold / hpk - 1);
    const want = wantInvested(i, inv);
    if (want !== inv) { inv = want; eq *= 1 - cost; trades++; }
  }
  const pct = x => +((x - 1) * 100).toFixed(1);
  return { costPct: cost * 100, retPct: pct(eq), holdPct: pct(hold), maxDDPct: +(dd * 100).toFixed(1), holdMaxDDPct: +(hdd * 100).toFixed(1), trades };
}

const report = { generatedAt: new Date().toISOString(), start: new Date(startMs).toISOString().slice(0, 10), assets: {} };
for (const [sym, rows] of Object.entries(data)) {
  const c = rows.map(r => +r.c), t = rows.map(r => +r.t);
  const i0 = t.findIndex(x => x >= startMs);
  const i200 = Math.max(i0, 199);
  const exitRule = h => (i, inv) => { const s = v04(c, i, h); return s === 'DOWN' ? 0 : s === 'UP' ? 1 : inv; };
  report.assets[sym] = {
    v04Skill: [1, 3, 7].map(h => forecastSkill(c, i0, h)),
    v04AsExitRule: [1, 7].flatMap(h => COSTS.map(k => ({ h, ...simulate(c, i0, exitRule(h), k) }))),
    trendFilterSma200: { start: new Date(t[i200]).toISOString().slice(0, 10),
      runs: COSTS.map(k => simulate(c, i200, i => c[i] > sma(c, i, 200) ? 1 : 0, k)) }
  };
}
console.log(JSON.stringify(report, null, 2));
