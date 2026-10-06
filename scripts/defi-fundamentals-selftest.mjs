import assert from 'node:assert/strict';
import { summarizeTvl, summarizeFlow, summarizeStablecoinContext, evaluateFundamentals } from '../src/defi-fundamentals.mjs';

const now = 2_000_000_000;
const protocol = { tvl: [
  { date: now-30*86400, totalLiquidityUSD: 100 },
  { date: now-7*86400, totalLiquidityUSD: 110 },
  { date: now, totalLiquidityUSD: 121 }
]};
const tvl = summarizeTvl(protocol, null, now);
assert.equal(tvl.change_7d_pct, 10);
assert.equal(tvl.change_30d_pct, 21);

const feeRows = [];
for (let i=14;i>=0;i--) feeRows.push([now-i*86400, i <= 6 ? 20 : 10]);
const fees = summarizeFlow({ total24h: 20, totalDataChart: feeRows }, now);
assert.ok(fees.momentum_7d_vs_prior7d_pct > 0);

const stableRows = [
  { date: now-30*86400, totalCirculating: { peggedUSD: 1000 } },
  { date: now-7*86400, totalCirculating: { peggedUSD: 1050 } },
  { date: now, totalCirculating: { peggedUSD: 1100 } }
];
const stable = summarizeStablecoinContext(stableRows, now);
assert.equal(stable.change_7d_pct, 4.76);

const evalx = evaluateFundamentals({ tvl, fees, revenue: fees, stablecoins: stable });
assert.equal(evalx.confirmation, 'confirms');
assert.ok(evalx.fundamental_quality_0_100 >= 65);
assert.equal(evalx.confidence_0_100, 100);
assert.equal(evalx.actionability, 'may_confirm_degrade_or_veto_but_never_create_buy_signal');

const partial = evaluateFundamentals({ tvl, fees: null, revenue: null, stablecoins: null });
assert.equal(partial.confirmation, 'insufficient_data');
assert.equal(partial.fundamental_quality_0_100, null);
assert.equal(partial.confidence_0_100, 40);

const scoped = evaluateFundamentals({ tvl, fees, revenue: fees, stablecoins: stable, scopePenalty: 10 });
assert.equal(scoped.confidence_0_100, 90);
assert.equal(scoped.scope_penalty_points, 10);

console.log('DefiLlama fundamentals self-test passed');
