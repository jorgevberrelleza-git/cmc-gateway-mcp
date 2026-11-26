// Bitso order specification — PURE (no network, no credentials).
// Shared by the locked trade client and the rehearsal path, so both format and
// bound orders identically. Book precision verified against Bitso available_books
// (btc_usd tick 1, ada_usd tick 0.00001; 20-nov-2026).
export const TRADE_LIMITS = Object.freeze({ minOrderUsd: 5, maxOrderUsd: 2500, collarMaxPct: 2 });
export const BOOKS = Object.freeze({
  btc_usd: Object.freeze({ majorDecimals: 8, priceDecimals: 0, tick: 1 }),
  ada_usd: Object.freeze({ majorDecimals: 2, priceDecimals: 5, tick: 0.00001 })
});
export const ORIGIN_ID_RE = /^shadow-[a-f0-9]{24}$/;

/** Format a positive finite number at a precision without exponent notation. */
export function fmt(n, decimals, what, round = 'floor') {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error('trade:bad_' + what);
  const f = 10 ** decimals;
  const steps = Math.round(n * f * 1e6) / 1e6; // float-safe
  const s = ((round === 'ceil' ? Math.ceil(steps) : Math.floor(steps)) / f).toFixed(decimals);
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) throw new Error('trade:bad_' + what + '_format');
  return s;
}

/** Collar price at the book tick, rounded to the conservative side. */
export function collarPrice({ side, bid, ask, collarPct, book }) {
  if (side !== 'buy' && side !== 'sell') throw new Error('trade:bad_side');
  const b = BOOKS[book]; if (!b) throw new Error('trade:book_not_allowed:' + book);
  if (!(bid > 0 && ask >= bid && collarPct > 0 && collarPct <= TRADE_LIMITS.collarMaxPct)) throw new Error('trade:bad_collar_inputs');
  const raw = side === 'buy' ? ask * (1 + collarPct / 100) : bid * (1 - collarPct / 100);
  const steps = Math.round((raw / b.tick) * 1e9) / 1e9;
  const q = side === 'buy' ? Math.floor(steps) : Math.ceil(steps); // buy never above, sell never below the collar
  return +(q * b.tick).toFixed(b.priceDecimals);
}

/**
 * Validate and format a limit-IOC order exactly as it would be sent.
 * Returns { book, side, major, price, notionalUsd, originId } with string amounts.
 */
export function buildLimitIoc({ book, side, major, price, originId }) {
  const b = BOOKS[book]; if (!b) throw new Error('trade:book_not_allowed:' + book);
  if (side !== 'buy' && side !== 'sell') throw new Error('trade:bad_side');
  if (!ORIGIN_ID_RE.test(String(originId))) throw new Error('trade:bad_origin_id');
  // Amount always floored; price rounded to the conservative side (sell up, buy down).
  const majorS = fmt(major, b.majorDecimals, 'major');
  const priceS = fmt(price, b.priceDecimals, 'price', side === 'sell' ? 'ceil' : 'floor');
  const notional = Number(majorS) * Number(priceS);
  if (notional < TRADE_LIMITS.minOrderUsd) throw new Error('trade:below_min_order_usd');
  if (notional > TRADE_LIMITS.maxOrderUsd) throw new Error('trade:above_max_order_usd');
  return { book, side, major: majorS, price: priceS, notionalUsd: +notional.toFixed(2), originId };
}

/** Translate a planner order (executor-v08 report.orders[i]) + live quote into a limit-IOC spec. */
export function translatePlannedOrder(order, quote, collarPct = 0.5) {
  const price = collarPrice({ side: order.side, bid: quote.bid, ask: quote.ask, collarPct, book: order.book });
  return buildLimitIoc({ book: order.book, side: order.side, major: order.major, price, originId: order.clientOrderId });
}
