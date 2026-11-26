// Post-trade reconciliation for Shadow LIVE orders (pure, no I/O).
// Compares what Shadow journaled with what Bitso reports (order status + order
// trades) and with account balances. Any discrepancy that could mean money was
// moved in a way Shadow did not intend latches a HALT; it never "fixes" by trading.
//
// Inputs come from the read-only client:
//   lookupOrders(originIds) -> [{ origin_id, oid, book, side, status, original_amount, unfilled_amount, price }]
//   orderTrades(originId)   -> [{ origin_id, oid, book, side, major, minor, price, fees_amount, fees_currency }]
// Bitso signs amounts (major < 0 on sells, fees < 0); this module uses magnitudes.
import { BOOKS } from './bitso-order-spec.mjs';

export const RECONCILE_VERSION = 'shadow-fill-reconcile-v0.1';
export const RECONCILE_DEFAULTS = Object.freeze({
  graceMs: 10 * 60_000,      // an order not visible at Bitso after this is considered not executed
  iocOpenMaxMs: 2 * 60_000,  // an IOC still open after this is abnormal -> cancel it
  overfillTol: 1e-9,         // relative tolerance on filled amount
  priceTol: 1e-9,            // relative tolerance on fill price vs limit
  balanceTol: 0.002          // 0.2% shortfall tolerance on balances (fees, dust)
});
const OPEN = new Set(['queued', 'open', 'partially filled']);
const DONE = new Set(['completed', 'cancelled']);

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

/** Reconcile one journaled LIVE order. */
export function reconcileOrder({ entry, venueOrder = null, trades = [], now = new Date(), params = {} }) {
  const p = { ...RECONCILE_DEFAULTS, ...params };
  const anomalies = [];
  const requested = num(entry.major), limit = num(entry.price);
  const [major, minor] = String(entry.book).split('_');
  if (!BOOKS[entry.book]) anomalies.push('unknown_book');
  if (!(requested > 0) || !(limit > 0)) anomalies.push('bad_journal_entry');

  let filled = 0, quote = 0, feesUsd = 0;
  for (const t of trades) {
    if (t.origin_id != null && t.origin_id !== entry.originId) { anomalies.push('trade_origin_mismatch'); continue; }
    if (t.book !== entry.book) anomalies.push('trade_book_mismatch');
    if (t.side !== entry.side) anomalies.push('trade_side_mismatch');
    const q = Math.abs(num(t.major)), px = num(t.price), fee = Math.abs(num(t.fees_amount));
    if (!(q > 0) || !(px > 0)) { anomalies.push('bad_trade_values'); continue; }
    filled += q; quote += q * px;
    const fc = String(t.fees_currency || '').toLowerCase();
    if (Number.isFinite(fee)) feesUsd += fc === minor ? fee : fc === major ? fee * px : 0;
    if (Number.isFinite(fee) && fc !== minor && fc !== major) anomalies.push('fee_currency_unexpected');
  }
  const avgPrice = filled > 0 ? quote / filled : null;
  if (filled > requested * (1 + p.overfillTol) + 1e-12) anomalies.push('overfill');
  if (avgPrice != null) {
    if (entry.side === 'buy' && avgPrice > limit * (1 + p.priceTol)) anomalies.push('fill_above_buy_limit');
    if (entry.side === 'sell' && avgPrice < limit * (1 - p.priceTol)) anomalies.push('fill_below_sell_limit');
  }
  if (venueOrder) {
    if (venueOrder.origin_id !== entry.originId) anomalies.push('venue_origin_mismatch');
    if (venueOrder.book && venueOrder.book !== entry.book) anomalies.push('venue_book_mismatch');
    if (venueOrder.side && venueOrder.side !== entry.side) anomalies.push('venue_side_mismatch');
    if (venueOrder.status && !OPEN.has(venueOrder.status) && !DONE.has(venueOrder.status)) anomalies.push('venue_status_unknown');
  }

  const ageMs = now.getTime() - new Date(entry.createdAt).getTime();
  const status = venueOrder?.status || null;
  let state, action = null;
  if (status && OPEN.has(status)) {
    state = 'PENDING';
    if (ageMs > p.iocOpenMaxMs) { anomalies.push('ioc_still_open'); action = 'CANCEL'; }
  } else if (filled >= requested * (1 - p.overfillTol)) state = 'FILLED';
  else if (filled > 0) state = (status && DONE.has(status)) || ageMs > p.graceMs ? 'PARTIAL' : 'PENDING';
  else if ((status && DONE.has(status)) || ageMs > p.graceMs) state = 'REJECTED'; // IOC that did not execute
  else state = 'PENDING';

  if (anomalies.some(a => a !== 'ioc_still_open')) action = 'HALT';
  const signed = entry.side === 'buy' ? filled : -filled;
  return { originId: entry.originId, book: entry.book, side: entry.side, state, action, anomalies: [...new Set(anomalies)],
    requestedMajor: requested, filledMajor: filled, signedMajor: signed, avgPrice, notionalUsd: quote, feesUsd,
    venueStatus: status, ageMs };
}

/**
 * Compare balances with what Shadow believes it holds for the mandate assets.
 * A shortfall (units missing) latches HALT: Shadow must not trade on a position
 * it cannot see. Extra units are reported, not touched (they belong to the owner).
 */
export function reconcileBalances({ expectedUnits, balances, params = {} }) {
  const p = { ...RECONCILE_DEFAULTS, ...params };
  const rows = [], anomalies = [];
  if (!balances) return { ok: false, rows, anomalies: ['balances_missing'], action: 'HALT' };
  for (const [asset, exp] of Object.entries(expectedUnits || {})) {
    const cur = asset.toLowerCase(), b = balances[cur];
    const have = b ? num(b.total) : 0, want = num(exp);
    if (!Number.isFinite(want) || want < 0) { anomalies.push(`bad_expected:${asset}`); continue; }
    const shortfall = want - have;
    const row = { asset, expected: want, actual: have, diff: have - want };
    if (shortfall > want * p.balanceTol + 1e-12) { row.status = 'SHORTFALL'; anomalies.push(`balance_shortfall:${asset}`); }
    else row.status = have > want * (1 + p.balanceTol) ? 'EXTRA_OWNER_UNITS' : 'OK';
    rows.push(row);
  }
  return { ok: anomalies.length === 0, rows, anomalies, action: anomalies.length ? 'HALT' : null };
}

/** Reconcile every unresolved LIVE entry plus balances; one verdict for the runner. */
export function reconcileAll({ entries = [], venueOrders = [], tradesByOrigin = {}, expectedUnits = null, balances = null, now = new Date(), params = {} }) {
  const byOrigin = new Map(venueOrders.map(o => [o.origin_id, o]));
  const results = entries.map(entry => reconcileOrder({ entry, venueOrder: byOrigin.get(entry.originId) || null,
    trades: tradesByOrigin[entry.originId] || [], now, params }));
  const bal = expectedUnits ? reconcileBalances({ expectedUnits, balances, params }) : null;
  const halt = results.some(r => r.action === 'HALT') || bal?.action === 'HALT';
  const cancel = results.filter(r => r.action === 'CANCEL').map(r => r.originId);
  const pending = results.filter(r => r.state === 'PENDING').length;
  return { version: RECONCILE_VERSION, at: now.toISOString(), halt, cancel, pending,
    resolved: results.filter(r => r.state !== 'PENDING').length, results, balances: bal,
    anomalies: [...results.flatMap(r => r.anomalies.map(a => `${r.originId}:${a}`)), ...(bal?.anomalies || [])] };
}
