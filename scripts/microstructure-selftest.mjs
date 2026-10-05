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
  { price:'100', amount:'2', maker_side:'sell', created_at:new Date(Date.now()-60_000).toISOString() },
  { price:'100', amount:'1', maker_side:'buy', created_at:new Date(Date.now()-120_000).toISOString() }
]);
assert.ok(recent.aggressive_flow_imbalance > 0.3);
assert.ok(recent.freshness_0_100 >= 80);

const base = Date.now()-18000;
const ws = _test.summarizeWs({
  capture_ms:18000,
  requested_min_capture_ms:18000,
  max_capture_ms:45000,
  adaptive_min_live_trades:3,
  adaptive_stop_reason:'live_trade_target_met',
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
assert.equal(ws.matched_lifecycle.evidence_quality, 'directionally_useful');
assert.equal(ws.wall_persistence.dominant_wall.oid, 'w1');
assert.ok(ws.mid_path.down_sweep_recovery >= 0.6);
assert.ok(ws.confidence_0_100 >= 55);

const pressure = _test.summarizePersistentWallPressure(ws.wall_persistence, 100);
assert.equal(pressure.available, true);
assert.ok(pressure.pressure_score_minus100_to100 > 0);

const trap = _test.computeTrapRisk(depth, ws, recent);
assert.ok(trap.score >= 20);

const spot = _test.computeSpotConfirmation(depth, ws, recent, pressure);
assert.ok(spot.confidence_0_100 >= 55);
assert.ok(spot.rest_trade_freshness_0_100 >= 80);

const cancellationOnlyWs = _test.summarizeWs({
  capture_ms:45000,
  orders_snapshots:Array.from({length:20},(_,i)=>({sent:base+i*1000,mid:100,bid_value_top20:500,ask_value_top20:500,wall_candidates:[]})),
  diff_events:40,
  diff_counts_raw:{open:10,cancelled:10,completed:0,other:0},
  lifecycle_counts:{opened_during_capture:10,cancelled:10,completed:0,unresolved:0},
  open_order_notionals:Array(10).fill(100),
  lifecycle_pairs:Array.from({length:10},(_,i)=>({outcome:'cancelled',lifetime_ms:1000,notional:i===0?1000:100})),
  sequence_gaps:0,
  stream_trades:[],
  errors:[]
});
assert.equal(cancellationOnlyWs.matched_lifecycle.evidence_quality, 'cancellation_only_context');
const cancellationOnlyTrap = _test.computeTrapRisk(depth, cancellationOnlyWs, recent);
assert.ok(cancellationOnlyTrap.score < 40);

const venue = _test.venuePriceCheck('ADA','usd',{mid:1.01},{structuredContent:{headers:['symbol','price'],rows:[['ADA',1.0]]}});
assert.equal(venue.available,true);
assert.ok(venue.basis_bps > 90);

console.log('microstructure v0.6 self-test: ok');
