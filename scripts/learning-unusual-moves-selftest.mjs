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
{ const u = detectUnusual({ asset: 'BTC', candles: series(800, -0.03), now: now(800) });
  assert.equal(u.direction1h, 'DOWN'); assert.ok(u.trigger.includes('1h')); }
{ const u = detectUnusual({ asset: 'BTC', candles: series(800, 0.03), now: now(800) });
  assert.equal(u.direction1h, 'UP', 'a 1h jump up is labelled UP even if the 24h move is down'); }
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, 0.012), now: now(800) }).level, 'UNUSUAL');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, 0, 600), now: now(800) }).level, 'UNUSUAL', 'volume spike x6');
// Open (unclosed) hour is ignored: the shock candle is still open -> calm.
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800, -0.05), now: new Date(t0 + 799 * H + 60_000) }).level, 'NORMAL');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(100), now: now(100) }).level, 'UNKNOWN');
assert.equal(detectUnusual({ asset: 'BTC', candles: series(800), now: now(805) }).reason, 'stale_data');

// --- Watch postures (owner holdings outside the mandate): same SMA200 rule, informational only.
{
  const { watchPostures, formatWatch } = await import('../src/learning/watch-postures-v01.mjs');
  const day = 86_400_000, now = new Date('2026-11-22T18:00:00Z'), start = Date.UTC(2026, 0, 1);
  const mk = f => ({ error: [], result: { AAVEUSD: Array.from({ length: 326 }, (_, i) => [(start + i * day) / 1000, 0, 0, 0, String(f(i)), 0, 0, 0]), last: 0 } });
  const fake = f => async () => ({ json: async () => mk(f) });
  const down = await watchPostures({ assets: ['AAVE'], pairs: { AAVE: 'AAVEUSD' }, now, fetchImpl: fake(i => 300 - i * 0.6) });
  assert.equal(down[0].posture, 'RISK_OFF'); assert.ok(down[0].distancePct < 0); assert.match(down[0].line, /^AAVE:RISK_OFF:-\d/);
  const up = await watchPostures({ assets: ['AAVE'], pairs: { AAVE: 'AAVEUSD' }, now, fetchImpl: fake(i => 50 + i * 0.6) });
  assert.equal(up[0].posture, 'RISK_ON');
  const bad = await watchPostures({ assets: ['AAVE'], pairs: {}, now, fetchImpl: async () => { throw new Error('net'); } });
  assert.equal(bad[0].posture, 'ABSTAIN'); assert.equal(bad[0].line, 'AAVE:ABSTAIN:fetch_failed');
  assert.equal(formatWatch({ asset: 'AAVE', posture: 'ABSTAIN', reason: 'insufficient_history' }), 'AAVE:ABSTAIN:insufficient_history');
  const src = (await import('node:fs')).readFileSync(new URL('../src/learning/watch-postures-v01.mjs', import.meta.url), 'utf8');
  assert.ok(!/executor|ledger-v07|order/i.test(src.replace(/\/\/.*$/gm, '')), 'watch never touches executor/ledger/orders');
}
console.log('SHADOW_UNUSUAL_SELFTEST=' + JSON.stringify({ ok: true, version: UNUSUAL_VERSION, closedHoursOnly: true, watchInformationalOnly: true, affectsPositions: false }));
