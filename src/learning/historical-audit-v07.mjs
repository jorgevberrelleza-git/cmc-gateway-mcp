// Shadow historical audit v0.7 — pure, offline, deterministic. RESEARCH ONLY.
// Input: {SYMBOL:[{t:openTimeMs,c:close}]} daily closed candles, contiguous.
// Scores (1) a MOMENTUM-ONLY approximation of the frozen v0.4 votes (live code
// also uses a microstructure vote that has no history; here micro=0, so this
// is NOT the live v0.4), with the live neutral bands; (2) that rule as an exit
// rule vs HOLD; (3) the pre-declared SMA200 trend filter vs HOLD.
export const AUDIT_VERSION = 'shadow_historical_audit_v0.7.1';
export const AUDIT_HORIZONS = [{ d: 1, band: 1.5 }, { d: 3, band: 2.5 }, { d: 7, band: 4.0 }];
export const AUDIT_COSTS = [0.0042, 0.008];
const DAY = 86400000;
const sg = (v, th) => v >= th ? 1 : v <= -th ? -1 : 0;
export function momentumVote(c, i, d) {
  if (i < 7) return null;
  const a = sg((c[i] / c[i - 1] - 1) * 100, 2), w = sg((c[i] / c[i - 7] - 1) * 100, 4);
  const s = d === 1 ? 2 * a + w : d === 3 ? a + 2 * w : 3 * w;
  return s >= 3 ? 'UP' : s <= -3 ? 'DOWN' : 'ABSTAIN';
}
function sma(c, i, n) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += c[j]; return s / n; }
function outcome(r, band) { return r > band ? 'UP' : r < -band ? 'DOWN' : 'FLAT'; }
export function skill(c, i0, hz) {
  let n = 0, hit = 0, up = 0, down = 0, days = 0;
  for (let i = i0; i + hz.d < c.length; i++) {
    days++;
    const s = momentumVote(c, i, hz.d);
    if (s !== 'UP' && s !== 'DOWN') continue;
    const o = outcome((c[i + hz.d] / c[i] - 1) * 100, hz.band);
    n++; if (s === o) hit++; if (o === 'UP') up++; if (o === 'DOWN') down++;
  }
  const p = hit / n, base = Math.max(up, down) / n, nEff = n / hz.d;
  return { horizonDays: hz.d, neutralBandPct: hz.band, days, issued: n,
    coveragePct: +(100 * n / days).toFixed(1), hitPct: +(100 * p).toFixed(1),
    alwaysUpPct: +(100 * up / n).toFixed(1), alwaysDownPct: +(100 * down / n).toFixed(1),
    flatPct: +(100 * (n - up - down) / n).toFixed(1),
    seHitPctOverlapAdj: +(100 * Math.sqrt(p * (1 - p) / nEff)).toFixed(1),
    zVsBestConstantOverlapAdj: +((p - base) / Math.sqrt(base * (1 - base) / nEff)).toFixed(2) };
}
export function simulate(c, t, i0, want, cost) {
  let inv = want(i0, 0), eq = 1, hold = 1, pk = 1, hpk = 1, dd = 0, hdd = 0, trades = 0, inDays = 0, n = 0;
  const yr = {};
  for (let i = i0; i < c.length; i++) {
    // Year base = equity at the PREVIOUS close, so day 1 of each year counts.
    const y = new Date(t[i]).getUTCFullYear();
    yr[y] = yr[y] || { s: eq, hs: hold };
    if (i > i0) { const r = c[i] / c[i - 1]; hold *= r; if (inv) eq *= r; }
    const w = want(i, inv);
    if (w !== inv) { inv = w; eq *= 1 - cost; trades++; }
    pk = Math.max(pk, eq); hpk = Math.max(hpk, hold);
    dd = Math.min(dd, eq / pk - 1); hdd = Math.min(hdd, hold / hpk - 1);
    n++; inDays += inv;
    yr[y].e = eq; yr[y].he = hold;
  }
  const pct = x => +((x - 1) * 100).toFixed(1);
  return { costPerSidePct: +(cost * 100).toFixed(2), retPct: pct(eq), holdRetPct: pct(hold),
    maxDDPct: +(dd * 100).toFixed(1), holdMaxDDPct: +(hdd * 100).toFixed(1), trades,
    timeInMarketPct: +(100 * inDays / n).toFixed(0),
    byYear: Object.fromEntries(Object.entries(yr).map(([y, q]) => [y, { pol: pct(q.e / q.s), hold: pct(q.he / q.hs) }])) };
}
export function runAudit(data, { startMs = Date.UTC(2021, 0, 1) } = {}) {
  const out = { version: AUDIT_VERSION, start: new Date(startMs).toISOString().slice(0, 10), assets: {} };
  for (const sym of Object.keys(data).sort()) {
    const rows = data[sym], c = rows.map(r => +r.c), t = rows.map(r => +r.t);
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] !== DAY || !(c[i] > 0)) throw new Error('audit_v07:non_contiguous:' + sym + ':' + i);
    const i0 = t.findIndex(x => x >= startMs), i200 = Math.max(i0, 199);
    const exitRule = d => (i, inv) => { const s = momentumVote(c, i, d); return s === 'DOWN' ? 0 : s === 'UP' ? 1 : inv; };
    out.assets[sym] = {
      firstDay: new Date(t[0]).toISOString().slice(0, 10), lastDay: new Date(t[t.length - 1]).toISOString().slice(0, 10),
      momentumOnlySkill: AUDIT_HORIZONS.map(h => skill(c, i0, h)),
      momentumOnlyAsExitRule: [1, 7].flatMap(d => AUDIT_COSTS.map(k => ({ horizonDays: d, ...simulate(c, t, i0, exitRule(d), k) }))),
      trendFilterSma200: { start: new Date(t[i200]).toISOString().slice(0, 10),
        runs: AUDIT_COSTS.map(k => simulate(c, t, i200, i => (c[i] > sma(c, i, 200) ? 1 : 0), k)) }
    };
  }
  return out;
}
