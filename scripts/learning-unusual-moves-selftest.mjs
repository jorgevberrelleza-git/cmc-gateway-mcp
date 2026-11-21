import assert from 'node:assert/strict';
import { detectUnusual, UNUSUAL_VERSION } from '../src/learning/unusual-moves-v01.mjs';

const H = 3_600_000, t0 = Date.UTC(2026, 9, 1);
let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; };
function series(n, shockLast = 0, volLast = 100) {
  let p = 100; const rows = [];
  for (let i = 0; i < n; i++) { p *= Math.exp(rnd() * 0.01); rows.push({ t: t0 + i * H, close: p, volume: 100 }); }
  rows[n - 1].close = rows[n - 2].close * Math.exp(shockLast); rows[n - 1].volume = volLast;
  return rows;
}
const now = n => new Date(t0 + n * H + 60_000); // one minute after the last hour closed

const calm = detectUnusual({ asset: 'BTC', candles: series(800), now: now(800) });
assert.equal(calm.level, 'NORMAL');
assert.equal(calm.affectsPositions, false);
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, -0.03), now: now(800) }).level, 'EXTREME'); // ~-3% in 1h vs ~0.29% sigma
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, 0.012), now: now(800) }).level, 'UNUSUAL');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, 0, 600), now: now(800) }).level, 'UNUSUAL', 'volume spike x6');
// Open (unclosed) hour is ignored: the shock candle is still open -> calm.
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, -0.05), now: new Date(t0 + 799 * H + 60_000) }).level, 'NORMAL');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(100), now: now(100) }).level, 'UNKNOWN');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800), now: now(805) }).reason, 'stale_data');
console.log('SHADOW_UNUSUAL_SELFTEST=' + JSON.stringify({ ok: true, version: UNUSUAL_VERSION, closedHoursOnly: true, affectsPositions: false }));
