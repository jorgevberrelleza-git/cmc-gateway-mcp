// Watch postures for the owner's holdings OUTSIDE the mandate (e.g. AAVE).
// Same frozen SMA200 rule as the mandate (trendPosture), evaluated per asset,
// purely informational: never feeds the paper ledger, the executor or any order.
// Evidence note: on AAVE the rule did NOT beat HOLD in 2021-2026 (time machine),
// so a watch posture is context, not a trading signal.
import { trendPosture } from './trend-filter-v07.mjs';

export const WATCH_VERSION = 'shadow-watch-v0.1';

export function formatWatch(p) {
  if (!p || p.posture === 'ABSTAIN' || p.distancePct == null) return `${p?.asset ?? '?'}:ABSTAIN:${p?.reason ?? 'na'}`;
  return `${p.asset}:${p.posture}:${p.distancePct}%:${p.lastCloseDay}`;
}

export async function watchPostures({ assets, pairs, now = new Date(), fetchImpl = fetch, timeoutMs = 8000 }) {
  const out = [];
  for (const asset of assets) {
    const pair = pairs[asset] || `${asset}USD`;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      const j = await fetchImpl(`https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=1440`, { signal: ctl.signal })
        .then(r => r.json()).finally(() => clearTimeout(t));
      if (j.error?.length) throw Error(j.error.join(','));
      const rows = Object.entries(j.result).find(([k]) => k !== 'last')[1];
      const p = trendPosture({ asset, candles: rows.map(k => ({ t: k[0] * 1000, close: +k[4] })), now, universe: [asset] });
      out.push({ asset, posture: p.posture, distancePct: p.distancePct ?? null, line: formatWatch(p) });
    } catch (e) { out.push({ asset, posture: 'ABSTAIN', error: String(e.message).slice(0, 80), line: `${asset}:ABSTAIN:fetch_failed` }); }
  }
  return out;
}
