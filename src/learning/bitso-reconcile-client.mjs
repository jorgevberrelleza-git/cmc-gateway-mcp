// Bitso GET-only lookups for post-trade reconciliation of Shadow LIVE orders.
// Kept separate from bitso-readonly-client.mjs so the dry-run executor build
// contains no order-endpoint code at all. No POST/DELETE path exists here.
// Only Shadow's own origin_ids (validated) can be queried; the query string is
// built here, never passed in by the caller.
import { signBitso } from './bitso-readonly-client.mjs';
import { ORIGIN_ID_RE } from './bitso-order-spec.mjs';

const BASES = Object.freeze({ orders: '/api/v3/orders', orderTrades: '/api/v3/order_trades' });
const QUERY_RE = /^\?origin_ids?=shadow-[a-f0-9]{24}(,shadow-[a-f0-9]{24}){0,19}$/;

function shadowIds(ids, max) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String))];
  if (!list.length || list.length > max || !list.every(id => ORIGIN_ID_RE.test(id))) throw new Error('bitso_reconcile:bad_origin_ids');
  return list;
}

export function makeBitsoReconcileClient({ key, secret, baseUrl = 'https://api.bitso.com', fetchImpl = fetch, timeoutMs = 8000 }) {
  if (!key || !secret) throw new Error('bitso_reconcile:credentials_missing');
  let lastNonce = 0;
  async function get(path) {
    const base = path.split('?')[0];
    if (!Object.values(BASES).includes(base) || !QUERY_RE.test(path.slice(base.length))) throw new Error('bitso_reconcile:path_not_allowed');
    const nonce = Math.max(Date.now(), lastNonce + 1); lastNonce = nonce;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(baseUrl + path, { method: 'GET', signal: ctl.signal,
        headers: { Authorization: signBitso({ key, secret, nonce, method: 'GET', path }) } });
      const j = await res.json();
      if (!res.ok || j.success !== true) throw new Error('bitso_reconcile:' + (j?.error?.code || res.status));
      return Array.isArray(j.payload) ? j.payload : [];
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({
    /** Status of Shadow orders by origin_id (max 20 per call). */
    lookupOrders: async ids => get(`${BASES.orders}?origin_ids=${shadowIds(ids, 20).join(',')}`),
    /** Fills of one Shadow order by origin_id. */
    orderTrades: async id => get(`${BASES.orderTrades}?origin_id=${shadowIds(id, 1)[0]}`)
  });
}
