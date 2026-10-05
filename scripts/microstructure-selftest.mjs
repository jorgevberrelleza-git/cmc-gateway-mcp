import assert from 'node:assert/strict';
import { _test } from '../src/microstructure.mjs';

const depth = _test.summarizeDepth({
  bids: [{ price:'99.95', amount:'10' }, { price:'99.90', amount:'10' }],
  asks: [{ price:'100.05', amount:'9' }, { price:'100.10', amount:'9' }]
});
assert.equal(depth.best_bid, 99.95);
assert.equal(depth.best_ask, 100.05);
assert.ok(depth.spread_bps > 9 && depth.spread_bps < 11);

const recent = _test.summarizeRecentTrades([
  { price:'100', amount:'2', maker_side:'sell', created_at:'2026-10-05T08:00:00Z' },
  { price:'100', amount:'1', maker_side:'buy', created_at:'2026-10-05T07:59:00Z' }
]);
assert.ok(recent.aggressive_flow_imbalance > 0.3);

const ws = _test.summarizeWs({
  capture_ms:6000,
  orders_snapshots:[
    {bid_value_top20:1000,ask_value_top20:200},
    {bid_value_top20:200,ask_value_top20:1000},
    {bid_value_top20:1000,ask_value_top20:200}
  ],
  diff_counts:{open:10,cancelled:8,completed:1,other:0},
  open_order_notionals:[100,100,100,100,100],
  ephemeral_pairs:[{outcome:'cancelled',lifetime_ms:500,notional:1000}],
  sequence_gaps:0,
  stream_trades:[],
  errors:[]
});
assert.equal(ws.large_fast_cancelled_orders, 1);
assert.equal(ws.imbalance_sign_flips, 2);
const trap = _test.computeTrapRisk(depth, ws, recent);
assert.ok(trap.score >= 40);
console.log('microstructure self-test: ok');
