import assert from 'node:assert/strict';
import { reconcileOrder, reconcileBalances, reconcileAll } from '../src/learning/fill-reconciliation-v01.mjs';
import fs from 'node:fs';
import { makeBitsoReconcileClient } from '../src/learning/bitso-reconcile-client.mjs';
import { makePgOrderJournal } from '../src/learning/order-journal-pg.mjs';

const id = n => 'shadow-' + String(n).repeat(24).slice(0, 24);
const now = new Date('2027-02-01T12:00:00Z');
const ago = ms => new Date(now.getTime() - ms).toISOString();
const sell = { originId: id(1), book: 'btc_usd', side: 'sell', major: 0.01249, price: 58705, createdAt: ago(5 * 60_000) };
const buy = { originId: id(2), book: 'ada_usd', side: 'buy', major: 11500, price: 0.1422, createdAt: ago(5 * 60_000) };
const tr = (e, major, price, extra = {}) => ({ origin_id: e.originId, oid: 'o' + e.originId.slice(-4), book: e.book, side: e.side,
  major: String(e.side === 'sell' ? -major : major), price: String(price), fees_amount: String(-(e.side === 'sell' ? major * price * 0.0036 : major * 0.0036)),
  fees_currency: e.side === 'sell' ? 'usd' : e.book.split('_')[0], ...extra });

// 1. Full fill at or better than the limit -> FILLED, fees in USD.
let r = reconcileOrder({ entry: sell, venueOrder: { origin_id: sell.originId, book: 'btc_usd', side: 'sell', status: 'completed' },
  trades: [tr(sell, 0.006, 58800), tr(sell, 0.00649, 58710)], now });
assert.equal(r.state, 'FILLED'); assert.equal(r.action, null); assert.ok(Math.abs(r.filledMajor - 0.01249) < 1e-12);
assert.ok(r.avgPrice >= sell.price && r.signedMajor < 0); assert.ok(r.feesUsd > 2.6 && r.feesUsd < 2.7);
// Buy fees charged in the major currency are valued at the fill price.
r = reconcileOrder({ entry: buy, venueOrder: { origin_id: buy.originId, status: 'completed' }, trades: [tr(buy, 11500, 0.1419)], now });
assert.equal(r.state, 'FILLED'); assert.ok(Math.abs(r.feesUsd - 11500 * 0.1419 * 0.0036) < 1e-9); assert.ok(r.signedMajor > 0);

// 2. IOC partially filled then cancelled -> PARTIAL (final).
r = reconcileOrder({ entry: buy, venueOrder: { origin_id: buy.originId, status: 'cancelled' }, trades: [tr(buy, 4000, 0.142)], now });
assert.equal(r.state, 'PARTIAL'); assert.equal(r.action, null);

// 3. IOC with no fill: cancelled -> REJECTED; not visible yet -> PENDING; not visible after grace -> REJECTED.
assert.equal(reconcileOrder({ entry: buy, venueOrder: { origin_id: buy.originId, status: 'cancelled' }, trades: [], now }).state, 'REJECTED');
assert.equal(reconcileOrder({ entry: { ...buy, createdAt: ago(60_000) }, trades: [], now }).state, 'PENDING');
assert.equal(reconcileOrder({ entry: { ...buy, createdAt: ago(11 * 60_000) }, trades: [], now }).state, 'REJECTED');

// 4. An IOC that stays open is abnormal -> CANCEL (only Shadow's own order).
r = reconcileOrder({ entry: buy, venueOrder: { origin_id: buy.originId, status: 'open' }, trades: [], now });
assert.equal(r.state, 'PENDING'); assert.equal(r.action, 'CANCEL');

// 5. Money-safety anomalies latch HALT.
const halt = (args, tag) => { const x = reconcileOrder({ now, ...args }); assert.equal(x.action, 'HALT', tag); assert.ok(x.anomalies.includes(tag), tag); };
halt({ entry: sell, trades: [tr(sell, 0.02, 58800)] }, 'overfill');
halt({ entry: sell, trades: [tr(sell, 0.01249, 58000)] }, 'fill_below_sell_limit');
halt({ entry: buy, trades: [tr(buy, 11500, 0.15)] }, 'fill_above_buy_limit');
halt({ entry: buy, trades: [tr(buy, 100, 0.14, { side: 'sell' })] }, 'trade_side_mismatch');
halt({ entry: buy, trades: [tr(buy, 100, 0.14, { book: 'btc_usd' })] }, 'trade_book_mismatch');
halt({ entry: buy, trades: [tr(buy, 100, 0.14, { origin_id: id(9) })] }, 'trade_origin_mismatch');
halt({ entry: buy, venueOrder: { origin_id: buy.originId, status: 'weird' }, trades: [] }, 'venue_status_unknown');

// 6. Balances: a shortfall vs what Shadow believes it holds latches HALT; the owner's extra units are untouched.
let b = reconcileBalances({ expectedUnits: { BTC: 0.01249, ADA: 12000 }, balances: { btc: { total: 0.01249 }, ada: { total: 12500 } } });
assert.equal(b.ok, true); assert.equal(b.rows.find(x => x.asset === 'ADA').status, 'EXTRA_OWNER_UNITS');
b = reconcileBalances({ expectedUnits: { BTC: 0.01249, ADA: 12000 }, balances: { btc: { total: 0.012 }, ada: { total: 12000 } } });
assert.equal(b.action, 'HALT'); assert.deepEqual(b.anomalies, ['balance_shortfall:BTC']);
assert.ok(reconcileBalances({ expectedUnits: { BTC: 0.01249 }, balances: { btc: { total: 0.012475 } } }).ok, 'fee dust within 0.2%');
assert.equal(reconcileBalances({ expectedUnits: { BTC: 1 }, balances: null }).action, 'HALT');

// 7. Aggregate verdict.
const all = reconcileAll({ entries: [sell, buy], venueOrders: [{ origin_id: sell.originId, status: 'completed' }, { origin_id: buy.originId, status: 'open' }],
  tradesByOrigin: { [sell.originId]: [tr(sell, 0.01249, 58710)] }, expectedUnits: { BTC: 0, ADA: 12000 },
  balances: { btc: { total: 0 }, ada: { total: 12000 }, usd: { total: 730 } }, now });
assert.equal(all.halt, false); assert.deepEqual(all.cancel, [buy.originId]); assert.equal(all.pending, 1); assert.equal(all.resolved, 1);

// 8. Read-only client: lookups only for Shadow origin_ids, query built internally, still GET-only.
const calls = [];
const fetchImpl = async (url, init) => { calls.push({ url, method: init.method });
  return { ok: true, json: async () => ({ success: true, payload: [{ origin_id: id(1), status: 'completed' }] }) }; };
const ro = makeBitsoReconcileClient({ key: 'k', secret: 's', fetchImpl });
assert.equal((await ro.lookupOrders([id(1), id(2)])).length, 1);
await ro.orderTrades(id(1));
assert.deepEqual(calls.map(c => c.method), ['GET', 'GET']);
assert.ok(calls[0].url.endsWith(`/api/v3/orders?origin_ids=${id(1)},${id(2)}`)); assert.ok(calls[1].url.endsWith(`/api/v3/order_trades?origin_id=${id(1)}`));
await assert.rejects(() => ro.lookupOrders(['not-shadow']), /bad_origin_ids/);
await assert.rejects(() => ro.orderTrades(id(1) + '&x=1'), /bad_origin_ids/);
await assert.rejects(() => ro.lookupOrders(Array.from({ length: 21 }, (_, i) => 'shadow-' + i.toString(16).padStart(24, '0'))), /bad_origin_ids/);
assert.deepEqual(Object.keys(ro).sort(), ['lookupOrders', 'orderTrades']);
const rcSrc = fs.readFileSync(new URL('../src/learning/bitso-reconcile-client.mjs', import.meta.url), 'utf8');
assert.ok(!/method:\s*['"](POST|DELETE)['"]/.test(rcSrc), 'reconcile client is GET-only');

// 9. Journal: verdicts stored; HALT keeps the order UNKNOWN (blocks new orders); PENDING writes nothing.
const upd = [];
const db = { async query(sql, p) { upd.push({ sql: sql.trim(), p }); return { rowCount: 1, rows: [] }; } };
const lj = makePgOrderJournal(db, { mode: 'LIVE' });
assert.equal(await lj.markReconciled(id(1), { state: 'PENDING' }), false); assert.equal(upd.length, 0);
await lj.markReconciled(id(1), { state: 'FILLED', action: null, filledMajor: 1, anomalies: [] }); assert.equal(upd[0].p[2], 'FILLED');
await lj.markReconciled(id(1), { state: 'FILLED', action: 'HALT', anomalies: ['overfill'] }); assert.equal(upd[1].p[2], 'UNKNOWN');
assert.ok(/state in \('SENT','UNKNOWN'\)/.test(upd[0].sql), 'never rewrites a final row');

console.log('SHADOW_FILL_RECONCILIATION_SELFTEST=' + JSON.stringify({ ok: true, filledPartialRejected: true, iocOpenCancelled: true,
  anomaliesHalt: 7, balanceShortfallHalts: true, ownerUnitsUntouched: true, readOnlyLookupsShadowOnly: true, journalHaltStaysUnknown: true }));
