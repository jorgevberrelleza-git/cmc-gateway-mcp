// Shadow unusual-move detector v0.1 — INFORMATIONAL ONLY. Pure: no network/DB.
//
// Big news shows up in prices before any headline can be parsed. This flags
// statistically unusual hourly behaviour per asset from CLOSED hourly candles:
//   z1h  = last 1h log-return / sigma(1h over the last 30 days)
//   z24h = last 24h log-return / (sigma1h * sqrt(24))
//   volRatio = last hour volume / median hourly volume of the last 7 days
// Levels: EXTREME if |z1h|>=5 or |z24h|>=4; UNUSUAL if |z1h|>=3 or |z24h|>=2.5
// or volRatio>=4; else NORMAL. It never changes positions: there is no evidence
// yet that reacting to these flags improves results (docs/shadow-trend-filter-v07.md).
export const UNUSUAL_VERSION = 'shadow_unusual_moves_v0.1';
const HOUR = 3_600_000;

export function detectUnusual({ asset, candles, now = new Date() }) {
  const base = { version: UNUSUAL_VERSION, asset, at: new Date(+now).toISOString(), affectsPositions: false };
  const rows = (candles || []).map(c => ({ t: +c.t, close: +c.close, volume: +c.volume }))
    .filter(r => Number.isFinite(r.t) && r.close > 0 && r.t + HOUR <= +now) // closed hours only
    .sort((a, b) => a.t - b.t);
  if (rows.length < 24 * 8) return { ...base, level: 'UNKNOWN', reason: 'insufficient_history', hours: rows.length };
  const last = rows[rows.length - 1];
  if (+now - (last.t + HOUR) > 2 * HOUR) return { ...base, level: 'UNKNOWN', reason: 'stale_data' };
  const win = rows.slice(-721);
  const r = []; for (let i = 1; i < win.length; i++) r.push(Math.log(win[i].close / win[i - 1].close));
  const hist = r.slice(0, -1);
  const mean = hist.reduce((s, x) => s + x, 0) / hist.length;
  const sigma = Math.sqrt(hist.reduce((s, x) => s + (x - mean) ** 2, 0) / (hist.length - 1));
  if (!(sigma > 0)) return { ...base, level: 'UNKNOWN', reason: 'zero_volatility' };
  const r1 = r[r.length - 1];
  const r24 = Math.log(last.close / win[win.length - 25].close);
  const z1h = r1 / sigma, z24h = r24 / (sigma * Math.sqrt(24));
  const vols = rows.slice(-169, -1).map(x => x.volume).filter(v => v >= 0).sort((a, b) => a - b);
  const med = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
  const volRatio = med > 0 ? last.volume / med : null;
  const extreme = Math.abs(z1h) >= 5 || Math.abs(z24h) >= 4;
  const unusual = Math.abs(z1h) >= 3 || Math.abs(z24h) >= 2.5 || (volRatio != null && volRatio >= 4);
  const pct = x => +((Math.exp(x) - 1) * 100).toFixed(2);
  return { ...base, level: extreme ? 'EXTREME' : unusual ? 'UNUSUAL' : 'NORMAL',
    direction: r24 >= 0 ? 'UP' : 'DOWN', move1hPct: pct(r1), move24hPct: pct(r24),
    z1h: +z1h.toFixed(2), z24h: +z24h.toFixed(2), volRatio: volRatio == null ? null : +volRatio.toFixed(2),
    lastHour: new Date(last.t).toISOString() };
}
