#!/usr/bin/env node
// Hourly unusual-move scan (informational). Kraken public hourly OHLC, closed hours only.
// No DB writes, no positions, no paid APIs. Prints one line.
import { detectUnusual, UNUSUAL_VERSION } from '../src/learning/unusual-moves-v01.mjs';

const PAIRS = { BTC: 'XBTUSD', ETH: 'ETHUSD', ADA: 'ADAUSD', AAVE: 'AAVEUSD' };
const now = new Date(); const out = []; const errors = [];
for (const [asset, pair] of Object.entries(PAIRS)) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const j = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`, { signal: ctl.signal }).then(r => r.json()).finally(() => clearTimeout(t));
    if (j.error?.length) throw Error(j.error.join(','));
    const rows = Object.entries(j.result).find(([k]) => k !== 'last')[1];
    out.push(detectUnusual({ asset, candles: rows.map(k => ({ t: k[0] * 1000, close: k[4], volume: k[6] })), now }));
  } catch (e) { errors.push(`${asset}:${e.message}`); out.push({ asset, level: 'UNKNOWN', reason: 'fetch_failed' }); }
}
// Calibrated on 2026 hourly data: UNUSUAL fires ~6% of hours (noise), EXTREME ~1% in a few
// market-wide episodes per month -> only EXTREME is raised as an alert.
const flagged = out.filter(x => x.level === 'EXTREME');
console.log('SHADOW_UNUSUAL=' + JSON.stringify({ ok: true, version: UNUSUAL_VERSION, at: now.toISOString(),
  flagged: flagged.map(x => `${x.asset}:${x.level}:24h ${x.direction}/1h ${x.direction1h}:trigger ${x.trigger}:1h ${x.move1hPct}%/24h ${x.move24hPct}% z${x.z1h}/${x.z24h} vol x${x.volRatio}`),
  assets: out.map(x => ({ asset: x.asset, level: x.level, m1h: x.move1hPct ?? null, m24h: x.move24hPct ?? null, z1h: x.z1h ?? null, z24h: x.z24h ?? null, vol: x.volRatio ?? null })),
  errors, affectsPositions: false }));
