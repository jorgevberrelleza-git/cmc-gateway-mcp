const REST_BASE = String(process.env.BITSO_REST_BASE || 'https://bitso.com/api/v3').replace(/\/$/, '');
const WS_URL = process.env.BITSO_WS_URL || 'wss://ws.bitso.com';
const HTTP_TIMEOUT_MS = Math.max(3000, Number(process.env.BITSO_TIMEOUT_MS || 12000));
const CAPTURE_MS = Math.min(12000, Math.max(3000, Number(process.env.BITSO_CAPTURE_MS || 6000)));
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
      headers: { 'accept': 'application/json', 'user-agent': 'cmc-gateway-microstructure/0.4.0' },
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
    if (names.has(candidate)) {
      return { book: candidate, major, minor, source: 'available_books' };
    }
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

function bookSnapshotFromWs(payload, sent) {
  const bids = Array.isArray(payload?.bids) ? payload.bids : [];
  const asks = Array.isArray(payload?.asks) ? payload.asks : [];
  const bid = bids.map(x => toNum(x?.r)).filter(x => x != null).sort((a,b) => b-a)[0] ?? null;
  const ask = asks.map(x => toNum(x?.r)).filter(x => x != null).sort((a,b) => a-b)[0] ?? null;
  const bidValue = bids.reduce((s, x) => s + (orderNotional(x) || 0), 0);
  const askValue = asks.reduce((s, x) => s + (orderNotional(x) || 0), 0);
  return { sent: toNum(sent) || Date.now(), bid, ask, bid_value_top20: bidValue, ask_value_top20: askValue };
}

export async function captureBitsoWebSocket(book, durationMs = CAPTURE_MS) {
  const { default: WebSocket } = await import('ws');
  const duration = Math.min(12000, Math.max(3000, Number(durationMs) || CAPTURE_MS));
  const startedAt = Date.now();
  const result = {
    book,
    capture_ms: duration,
    started_at: new Date(startedAt).toISOString(),
    ended_at: null,
    subscriptions: {},
    orders_snapshots: [],
    stream_trades: [],
    diff_counts: { open: 0, cancelled: 0, completed: 0, other: 0 },
    diff_events: 0,
    sequence_gaps: 0,
    ephemeral_pairs: [],
    open_order_notionals: [],
    errors: []
  };

  return await new Promise(resolve => {
    let settled = false;
    let lastSequence = null;
    const openSeen = new Map();
    const ws = new WebSocket(WS_URL, { handshakeTimeout: Math.min(HTTP_TIMEOUT_MS, 10000) });

    const finish = () => {
      if (settled) return;
      settled = true;
      result.ended_at = new Date().toISOString();
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
        if (result.orders_snapshots.length < 200) result.orders_snapshots.push(snap);
        return;
      }

      if (data?.type === 'trades' && Array.isArray(data?.payload)) {
        for (const t of data.payload) {
          if (result.stream_trades.length >= 500) break;
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
        if (seq != null && lastSequence != null && seq > lastSequence + 1) result.sequence_gaps += (seq - lastSequence - 1);
        if (seq != null) lastSequence = seq;
        for (const o of data.payload) {
          result.diff_events += 1;
          const status = String(o?.s || 'other').toLowerCase();
          if (status in result.diff_counts) result.diff_counts[status] += 1;
          else result.diff_counts.other += 1;
          const oid = o?.o != null ? String(o.o) : null;
          const now = toNum(o?.z) || toNum(data?.sent) || Date.now();
          if (status === 'open' && oid) {
            const notional = orderNotional(o);
            if (notional != null) result.open_order_notionals.push(notional);
            openSeen.set(oid, { at: toNum(o?.d) || now, notional, rate: toNum(o?.r), side: o?.t === 0 ? 'buy' : o?.t === 1 ? 'sell' : 'unknown' });
          } else if ((status === 'cancelled' || status === 'completed') && oid && openSeen.has(oid)) {
            const opened = openSeen.get(oid);
            result.ephemeral_pairs.push({
              oid,
              outcome: status,
              lifetime_ms: Math.max(0, now - opened.at),
              notional: opened.notional,
              rate: opened.rate,
              side: opened.side
            });
            openSeen.delete(oid);
          }
        }
      }
    });

    ws.on('error', error => {
      result.errors.push(error?.message || String(error));
    });
    ws.on('close', () => {
      if (!settled && Date.now() - startedAt > 500) {
        clearTimeout(timer);
        finish();
      }
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
