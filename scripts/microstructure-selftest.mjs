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

const base = 1760000000000;
const ws = _test.summarizeWs({
  capture_ms:18000,
  orders_snapshots:[
    {sent:base,mid:100,bid_value_top20:1000,ask_value_top20:200,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]},
    {sent:base+3000,mid:99.9,bid_value_top20:200,ask_value_top20:1000,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]},
    {sent:base+6000,mid:99.8,bid_value_top20:1000,ask_value_top20:200,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]},
    {sent:base+9000,mid:99.95,bid_value_top20:900,ask_value_top20:300,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]},
    {sent:base+12000,mid:100.02,bid_value_top20:800,ask_value_top20:350,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]},
    {sent:base+15000,mid:100.05,bid_value_top20:700,ask_value_top20:400,wall_candidates:[{oid:'w1',side:'bid',rate:99.9,notional:1000}]}
  ],
  diff_events:30,
  diff_counts_raw:{open:10,cancelled:8,completed:1,other:0},
  lifecycle_counts:{opened_during_capture:6,cancelled:4,completed:1,unresolved:1},
  open_order_notionals:[100,100,100,100,100,100],
  lifecycle_pairs:[
    {outcome:'cancelled',lifetime_ms:500,notional:1000},
    {outcome:'cancelled',lifetime_ms:1200,notional:100},
    {outcome:'cancelled',lifetime_ms:1500,notional:100},
    {outcome:'cancelled',lifetime_ms:2000,notional:100},
    {outcome:'completed',lifetime_ms:2500,notional:100}
  ],
  sequence_first:100,
  sequence_last:130,
  sequence_gaps:0,
  stream_trades:[
    {value:300,taker_side:'buy'},
    {value:100,taker_side:'sell'},
    {value:100,taker_side:'buy'}
  ],
  errors:[]
});
assert.equal(ws.large_fast_cancelled_orders, 1);
assert.ok(ws.matched_lifecycle.cancellation_share_observed > 0.7);
assert.equal(ws.wall_persistence.dominant_wall.oid, 'w1');
assert.ok(ws.mid_path.down_sweep_recovery >= 0.6);
assert.ok(ws.confidence_0_100 >= 55);

const trap = _test.computeTrapRisk(depth, ws, recent);
assert.ok(trap.score >= 35);

const spot = _test.computeSpotConfirmation(depth, ws, recent);
assert.ok(spot.confidence_0_100 >= 55);

const venue = _test.venuePriceCheck('ADA','usd',{mid:1.01},{structuredContent:{headers:['symbol','price'],rows:[['ADA',1.0]]}});
assert.equal(venue.available,true);
assert.ok(venue.basis_bps > 90);

console.log('microstructure v0.5 self-test: ok');
