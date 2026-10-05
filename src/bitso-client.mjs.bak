const REST_BASE = String(process.env.BITSO_REST_BASE || 'https://bitso.com/api/v3').replace(/\/$/, '');
const WS_URL = process.env.BITSO_WS_URL || 'wss://ws.bitso.com';
const HTTP_TIMEOUT_MS = Math.max(3000, Number(process.env.BITSO_TIMEOUT_MS || 12000));
const CAPTURE_MS = Math.min(30000, Math.max(6000, Number(process.env.BITSO_CAPTURE_MS || 18000)));
const BOOK_CACHE_MS = 10 * 60_000;
const PREFERRED_MINORS = String(process.env.BITSO_PREFERRED_MINORS || 'mxn,usd,usdc,usdt')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

let booksCache = { at: 0, payload: null };
let booksPromise = null;

async function fetchJson(path, params = {}) {
  const url = new URL(`${REST_BASE}/${String(path).replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'accept': 'application/json', 'user-agent': 'cmc-gateway-microstructure/0.5.0' },
      signal: controller.signal
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`Bitso returned non-JSON HTTP ${res.status}`); }
    if (!res.ok || body?.success === false) {
      const message = body?.error?.message || body?.error || `HTTP ${res.status}`;
      throw new Error(`Bitso REST error: ${message}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function listAvailableBooks() {
  const now = Date.now();
  if (booksCache.payload && now - booksCache.at < BOOK_CACHE_MS) return booksCache.payload;
  if (!booksPromise) {
    booksPromise = fetchJson('available_books/').then(body => {
      const payload = Array.isArray(body?.payload) ? body.payload : [];
      booksCache = { at: Date.now(), payload };
      return payload;
    }).finally(() => { booksPromise = null; });
  }
  return booksPromise;
}

export async function resolveBitsoBook(symbol, preferredMinors = PREFERRED_MINORS) {
  const major = String(symbol || '').trim().toLowerCase();
  if (!major) throw new Error('asset symbol is required');
  const books = await listAvailableBooks();
  const names = new Set(books.map(x => String(x?.book || '').toLowerCase()).filter(Boolean));
  for (const minor of preferredMinors) {
    const candidate = `${major}_${minor}`;
    if (names.has(candidate)) return { book: candidate, major, minor, source: 'available_books' };
  }
  const fallback = books.find(x => String(x?.book || '').toLowerCase().startsWith(`${major}_`));
  if (fallback?.book) {
    const [m, minor = 'unknown'] = String(fallback.book).toLowerCase().split('_');
    return { book: String(fallback.book).toLowerCase(), major: m, minor, source: 'available_books_fallback' };
  }
  return { book: null, major, minor: null, source: 'not_listed' };
}

export async function getBitsoOrderBook(book) {
  const body = await fetchJson('order_book/', { book, aggregate: 'true' });
  return body?.payload || {};
}

export async function getBitsoRecentTrades(book, limit = 100) {
  const safeLimit = Math.min(100, Math.max(10, Number(limit) || 100));
  const body = await fetchJson('trades/', { book, limit: safeLimit, sort: 'desc' });
  return Array.isArray(body?.payload) ? body.payload : [];
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function orderNotional(order) {
  const explicit = toNum(order?.v);
  if (explicit != null) return Math.abs(explicit);
  const a = toNum(order?.a ?? order?.amount);
  const r = toNum(order?.r ?? order?.price);
  return a != null && r != null ? Math.abs(a * r) : null;
}

function wallCandidates(items, side) {
  return (Array.isArray(items) ? items : [])
    .map(x => ({
      oid: x?.o != null ? String(x.o) : null,
      side,
      rate: toNum(x?.r),
      notional: orderNotional(x)
    }))
    .filter(x => x.rate != null && x.notional != null)
    .sort((a, b) => b.notional - a.notional)
    .slice(0, 3);
}

function bookSnapshotFromWs(payload, sent) {
  const bids = Array.isArray(payload?.bids) ? payload.bids : [];
  const asks = Array.isArray(payload?.asks) ? payload.asks : [];
  const bid = bids.map(x => toNum(x?.r)).filter(x => x != null).sort((a,b) => b-a)[0] ?? null;
  const ask = asks.map(x => toNum(x?.r)).filter(x => x != null).sort((a,b) => a-b)[0] ?? null;
  const bidValue = bids.reduce((s, x) => s + (orderNotional(x) || 0), 0);
  const askValue = asks.reduce((s, x) => s + (orderNotional(x) || 0), 0);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  const spreadBps = mid ? ((ask - bid) / mid) * 10000 : null;
  return {
    sent: toNum(sent) || Date.now(),
    bid,
    ask,
    mid,
    spread_bps: spreadBps,
    bid_value_top20: bidValue,
    ask_value_top20: askValue,
    wall_candidates: [...wallCandidates(bids, 'bid'), ...wallCandidates(asks, 'ask')]
  };
}

export async function captureBitsoWebSocket(book, durationMs = CAPTURE_MS) {
  const { default: WebSocket } = await import('ws');
  const duration = Math.min(30000, Math.max(6000, Number(durationMs) || CAPTURE_MS));
  const startedAt = Date.now();
  const result = {
    book,
    capture_ms: duration,
    started_at: new Date(startedAt).toISOString(),
    ended_at: null,
    subscriptions: {},
    orders_snapshots: [],
    stream_trades: [],
    diff_counts_raw: { open: 0, cancelled: 0, completed: 0, other: 0 },
    diff_events: 0,
    sequence_first: null,
    sequence_last: null,
    sequence_gaps: 0,
    lifecycle_counts: { opened_during_capture: 0, cancelled: 0, completed: 0, unresolved: 0 },
    lifecycle_pairs: [],
    unresolved_orders: [],
    open_order_notionals: [],
    errors: []
  };

  return await new Promise(resolve => {
    let settled = false;
    let lastSequence = null;
    const observed = new Map();
    const ws = new WebSocket(WS_URL, { handshakeTimeout: Math.min(HTTP_TIMEOUT_MS, 10000) });

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const endedAt = Date.now();
      for (const [oid, state] of observed.entries()) {
        if (!state.opened_during_capture || state.resolved) continue;
        result.lifecycle_counts.unresolved += 1;
        if (result.unresolved_orders.length < 250) {
          result.unresolved_orders.push({
            oid,
            lifetime_lower_bound_ms: Math.max(0, endedAt - state.first_seen_at),
            notional: state.initial_notional,
            rate: state.rate,
            side: state.side
          });
        }
      }
      result.ended_at = new Date(endedAt).toISOString();
      try { ws.close(1000, 'capture complete'); } catch {}
      resolve(result);
    };

    const timer = setTimeout(finish, duration);

    ws.on('open', () => {
      for (const type of ['orders', 'trades', 'diff-orders']) {
        ws.send(JSON.stringify({ action: 'subscribe', book, type }));
      }
    });

    ws.on('message', raw => {
      let data;
      try { data = JSON.parse(String(raw)); } catch { return; }
      if (data?.action === 'subscribe' && data?.type) {
        result.subscriptions[data.type] = data.response || 'unknown';
        return;
      }
      if (data?.type === 'ka') return;

      if (data?.type === 'orders' && data?.payload) {
        const snap = bookSnapshotFromWs(data.payload, data.sent);
        if (result.orders_snapshots.length < 600) result.orders_snapshots.push(snap);
        return;
      }

      if (data?.type === 'trades' && Array.isArray(data?.payload)) {
        for (const t of data.payload) {
          if (result.stream_trades.length >= 1500) break;
          result.stream_trades.push({
            at: toNum(t?.x) || toNum(data?.sent) || Date.now(),
            price: toNum(t?.r),
            amount: toNum(t?.a),
            value: toNum(t?.v),
            taker_side: t?.t === 0 ? 'buy' : t?.t === 1 ? 'sell' : 'unknown',
            tid: t?.i != null ? String(t.i) : null
          });
        }
        return;
      }

      if (data?.type === 'diff-orders' && Array.isArray(data?.payload)) {
        const seq = toNum(data?.sequence);
        if (seq != null && result.sequence_first == null) result.sequence_first = seq;
        if (seq != null && lastSequence != null && seq > lastSequence + 1) result.sequence_gaps += (seq - lastSequence - 1);
        if (seq != null) {
          lastSequence = seq;
          result.sequence_last = seq;
        }

        for (const o of data.payload) {
          result.diff_events += 1;
          const status = String(o?.s || 'other').toLowerCase();
          if (status in result.diff_counts_raw) result.diff_counts_raw[status] += 1;
          else result.diff_counts_raw.other += 1;

          const oid = o?.o != null ? String(o.o) : null;
          if (!oid) continue;
          const eventAt = toNum(o?.z) || toNum(data?.sent) || Date.now();
          const createdAt = toNum(o?.d) || eventAt;

          if (status === 'open') {
            let state = observed.get(oid);
            if (!state) {
              const openedDuringCapture = createdAt >= startedAt - 1500 && createdAt <= Date.now() + 1500;
              const notional = orderNotional(o);
              state = {
                first_seen_at: eventAt,
                created_at: createdAt,
                opened_during_capture: openedDuringCapture,
                initial_notional: notional,
                last_notional: notional,
                rate: toNum(o?.r),
                side: o?.t === 0 ? 'buy' : o?.t === 1 ? 'sell' : 'unknown',
                resolved: false
              };
              observed.set(oid, state);
              if (openedDuringCapture) {
                result.lifecycle_counts.opened_during_capture += 1;
                if (notional != null) result.open_order_notionals.push(notional);
              }
            } else {
              state.last_notional = orderNotional(o) ?? state.last_notional;
            }
            continue;
          }

          if ((status === 'cancelled' || status === 'completed')) {
            const state = observed.get(oid);
            if (!state || !state.opened_during_capture || state.resolved) continue;
            state.resolved = true;
            result.lifecycle_counts[status] += 1;
            if (result.lifecycle_pairs.length < 500) {
              result.lifecycle_pairs.push({
                oid,
                outcome: status,
                lifetime_ms: Math.max(0, eventAt - state.first_seen_at),
                created_to_resolution_ms: Math.max(0, eventAt - state.created_at),
                notional: state.initial_notional,
                last_notional: state.last_notional,
                rate: state.rate,
                side: state.side
              });
            }
          }
        }
      }
    });

    ws.on('error', error => result.errors.push(error?.message || String(error)));
    ws.on('close', () => {
      if (!settled && Date.now() - startedAt > 500) finish();
    });
  });
}

export async function collectBitsoRaw(symbol, { captureMs = CAPTURE_MS } = {}) {
  const resolved = await resolveBitsoBook(symbol);
  if (!resolved.book) {
    return { available: false, symbol: String(symbol).toUpperCase(), resolved, error: 'No public Bitso order book found for this asset.' };
  }

  const [orderBookResult, tradesResult, wsResult] = await Promise.allSettled([
    getBitsoOrderBook(resolved.book),
    getBitsoRecentTrades(resolved.book, 100),
    captureBitsoWebSocket(resolved.book, captureMs)
  ]);

  const errors = [];
  const unpack = (r, label, fallback) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${label}: ${r.reason?.message || String(r.reason)}`);
    return fallback;
  };

  return {
    available: true,
    symbol: String(symbol).toUpperCase(),
    resolved,
    order_book: unpack(orderBookResult, 'order_book', {}),
    recent_trades: unpack(tradesResult, 'recent_trades', []),
    websocket: unpack(wsResult, 'websocket', { book: resolved.book, errors: ['capture_failed'] }),
    errors
  };
}

export const BITSO_CONFIG = { REST_BASE, WS_URL, CAPTURE_MS, PREFERRED_MINORS };
