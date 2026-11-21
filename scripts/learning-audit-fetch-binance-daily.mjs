// Fetch public Binance daily klines into the audit input format and print its sha256.
// Binance blocks US IPs; run from a non-US network. Prices are USDT, NOT Bitso executable prices.
//   node scripts/learning-audit-fetch-binance-daily.mjs --out=daily.json [--from=2020-12-01] [--to=2026-11-20]
import fs from 'node:fs';
import crypto from 'node:crypto';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const out = arg('out') || 'daily.json';
const from = Date.parse(arg('from') || '2020-12-01'), to = Date.parse(arg('to') || '2026-11-20');
const SYMBOLS = ['AAVEUSDT', 'ADAUSDT', 'BTCUSDT', 'ETHUSDT', 'LINKUSDT', 'XRPUSDT'];
const data = {};
for (const sym of SYMBOLS) {
  const rows = []; let start = from;
  while (start < to) {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&startTime=${start}&limit=1000`).then(x => x.json());
    if (!Array.isArray(r) || !r.length) break;
    rows.push(...r); start = r[r.length - 1][0] + 86400000;
  }
  data[sym] = rows.filter(k => k[6] < to).map(k => ({ t: k[0], c: +k[4] }));
}
const raw = JSON.stringify(data);
fs.writeFileSync(out, raw);
console.log(JSON.stringify({ out, sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) }));
