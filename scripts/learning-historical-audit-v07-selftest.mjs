import assert from 'node:assert/strict';
import { momentumVote, skill, simulate, runAudit, AUDIT_VERSION } from '../src/learning/historical-audit-v07.mjs';

const DAY = 86400000;
const t0 = Date.UTC(2021, 11, 25);
const days = n => Array.from({ length: n }, (_, i) => t0 + i * DAY);

// Votes: +3%/day for a week => 24h UP; -3%/day => DOWN; flat => ABSTAIN; <8 bars => null.
const rise = Array.from({ length: 10 }, (_, i) => 100 * 1.03 ** i);
const fall = Array.from({ length: 10 }, (_, i) => 100 * 0.97 ** i);
assert.equal(momentumVote(rise, 8, 1), 'UP');
assert.equal(momentumVote(fall, 8, 1), 'DOWN');
assert.equal(momentumVote(Array(10).fill(100), 8, 1), 'ABSTAIN');
assert.equal(momentumVote(rise, 6, 1), null);

// Skill: steady +3%/day trend => every UP vote is a hit at 1d (+3% > 1.5% band).
const trend = Array.from({ length: 40 }, (_, i) => 100 * 1.03 ** i);
const sk = skill(trend, 8, { d: 1, band: 1.5 });
assert.equal(sk.hitPct, 100);
assert.equal(sk.alwaysUpPct, 100);
// Inside the neutral band the outcome is FLAT => an UP vote is a miss.
const slow = [...Array.from({ length: 9 }, (_, i) => 100 * 1.03 ** i)];
slow.push(slow[8] * 1.01);
assert.equal(skill(slow, 8, { d: 1, band: 1.5 }).hitPct, 0);

// Simulate: HOLD-equivalent policy matches HOLD; costs are charged per switch;
// a +100% move on Jan 1 is attributed to that year (regression for byYear bug).
const c = Array(14).fill(100); c[7] = 200; for (let i = 8; i < 14; i++) c[i] = 200; // t[7] = 2022-01-01
const t = days(14);
assert.equal(new Date(t[7]).toISOString().slice(0, 10), '2022-01-01');
const hold = simulate(c, t, 0, () => 1, 0.01);
assert.equal(hold.retPct, 100);
assert.equal(hold.trades, 0);
assert.equal(hold.byYear['2022'].pol, 100, 'Jan-1 return must count in 2022');
assert.equal(hold.byYear['2021'].pol, 0);
const flip = simulate(c, t, 0, i => (i === 3 ? 0 : i === 5 ? 1 : (i < 3 ? 1 : i < 5 ? 0 : 1)), 0.01);
assert.equal(flip.trades, 2);
assert.equal(flip.retPct, +((2 * 0.99 * 0.99 - 1) * 100).toFixed(1));
assert.ok(flip.maxDDPct < 0, 'drawdown measured after costs');

// runAudit rejects gaps and non-positive prices.
assert.throws(() => runAudit({ X: [{ t: t0, c: 1 }, { t: t0 + 2 * DAY, c: 1 }] }), /non_contiguous/);
assert.throws(() => runAudit({ X: [{ t: t0, c: 1 }, { t: t0 + DAY, c: 0 }] }), /non_contiguous/);

console.log('SHADOW_HISTORICAL_AUDIT_V07_SELFTEST=' + JSON.stringify({ ok: true, version: AUDIT_VERSION, byYearJan1Fixed: true, costsPerSwitch: true, bandsFlatAsMiss: true }));
