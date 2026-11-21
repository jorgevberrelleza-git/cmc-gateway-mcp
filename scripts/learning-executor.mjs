#!/usr/bin/env node
// Shadow executor runner — DRY_RUN ONLY (v0.8 owner mandate). Never sends orders.
// Postures: same frozen SMA200 rule (trendPosture) on Kraken closed daily candles,
// cross-checked against the sealed trend-ledger posture for shared assets.
// Balances: READ-ONLY Bitso key (BITSO_READONLY_API_KEY/SECRET).
// Mandate: SHADOW_MANDATE_JSON set by the owner, e.g. {"BTC":0.01249,"ADA":12000}.
import pg from 'pg';
import { planMandate, parseMandate, EXECUTOR_BOOKS, EXECUTOR_VERSION } from '../src/learning/executor-v08.mjs';
import { makeBitsoReadOnlyClient } from '../src/learning/bitso-readonly-client.mjs';
import { trendPosture } from '../src/learning/trend-filter-v07.mjs';
import { ledgerHash, TREND_LEDGER_VERSION } from '../src/learning/trend-ledger-v07.mjs';

const fail = m => { throw Error('executor_runner:' + m); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL_required');
if (String(process.env.SHADOW_EXECUTION_ENABLED || 'false').toLowerCase() === 'true') fail('live_execution_not_supported_in_this_build');
const mandate = parseMandate(process.env.SHADOW_MANDATE_JSON || '');
const KRAKEN_PAIR = { BTC: 'XBTUSD', ETH: 'ETHUSD', ADA: 'ADAUSD' };
const STABLE_USD = new Set(['usd', 'usdt', 'usdc', 'usds', 'tusd', 'dai', 'pyusd']);

async function getJson(url, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'shadow-research/0.8' } }); if (!r.ok) throw Error('HTTP' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function bitsoTicker(book) { const j = await getJson(`https://api.bitso.com/v3/ticker/?book=${book}`); if (!j.success) throw Error('ticker'); return { bid: +j.payload.bid, ask: +j.payload.ask }; }
async function krakenLast(cur) {
  const j = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${cur.toUpperCase()}USD`);
  if (j.error?.length) throw Error('kraken_ticker'); const v = Object.values(j.result)[0]; return Number(v.c[0]);
}
async function krakenDaily(asset) {
  const j = await getJson(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_PAIR[asset]}&interval=1440`);
  if (j.error?.length) throw Error('kraken_ohlc'); const rows = Object.entries(j.result).find(([k]) => k !== 'last')?.[1];
  return rows.map(k => ({ t: k[0] * 1000, close: +k[4] }));
}

async function bitsoDepth(book) {
  // Visible USD depth within 0.5% of mid on each side (aggregated public book).
  const j = await getJson(`https://api.bitso.com/v3/order_book/?book=${book}&aggregate=true`);
  if (!j.success) throw Error('order_book');
  const bids = j.payload.bids.map(x => [+x.price, +x.amount]), asks = j.payload.asks.map(x => [+x.price, +x.amount]);
  const mid = (bids[0][0] + asks[0][0]) / 2;
  const sum = side => side.filter(([p]) => Math.abs(p / mid - 1) <= 0.005).reduce((t, [p, q]) => t + p * q, 0);
  return { bid: sum(bids), ask: sum(asks) };
}
const now = new Date(), errors = [], unvalued = [];
const assets = Object.keys(mandate);
const postures = {}, quotes = {}, refPrices = {}, depthUsd = {};
for (const a of assets) {
  try { refPrices[a] = await krakenLast(a === 'BTC' ? 'XBT' : a); } catch (e) { errors.push(`${a}:reference:${e.message}`); }
  try { depthUsd[a] = await bitsoDepth(EXECUTOR_BOOKS[a]); } catch (e) { errors.push(`${a}:depth:${e.message}`); }
  try { postures[a] = trendPosture({ asset: a, candles: await krakenDaily(a), now, universe: assets }).posture; }
  catch (e) { postures[a] = 'ABSTAIN'; errors.push(`${a}:candles:${e.message}`); }
  try { quotes[a] = await bitsoTicker(EXECUTOR_BOOKS[a]); } catch (e) { errors.push(`${a}:quote:${e.message}`); }
}
let balances = null, portfolioUsd = 0;
if (process.env.BITSO_READONLY_API_KEY && process.env.BITSO_READONLY_API_SECRET) {
  try {
    balances = await makeBitsoReadOnlyClient({ key: process.env.BITSO_READONLY_API_KEY, secret: process.env.BITSO_READONLY_API_SECRET }).balances();
    for (const [cur, b] of Object.entries(balances)) {
      if (!(b.total > 0)) continue;
      if (STABLE_USD.has(cur)) { portfolioUsd += b.total; continue; }
      let px = null;
      if (cur === 'mxn') { try { const q = await bitsoTicker('usd_mxn'); px = 2 / (q.bid + q.ask); } catch { /* unvalued */ } }
      else try { const q = await bitsoTicker(`${cur}_usd`); px = (q.bid + q.ask) / 2; }
      catch { try { px = await krakenLast(cur); } catch { /* unvalued */ } }
      if (px > 0) portfolioUsd += b.total * px; else unvalued.push(cur); // excluded: conservative (smaller cap)
    }
  } catch (e) { errors.push('balances:' + e.message); balances = null; }
} else errors.push('balances:readonly_key_not_configured');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
let report = null, saved = false, duplicate = false;
await db.connect();
try {
  await db.query('begin');
  const lock = await db.query('select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired', [60017, 8]);
  if (lock.rows[0]?.acquired !== true) fail('concurrent_executor_locked');
  const snap = (await db.query('select id from learning_snapshots order by generated_at desc,id desc limit 1')).rows[0];
  if (!snap) fail('latest_snapshot_missing');
  // Cross-check with the sealed paper-ledger postures (single source of truth for shared assets).
  const led = (await db.query('select asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [TREND_LEDGER_VERSION])).rows[0]?.asset_assessments?.ledger;
  let postureAt = now.toISOString();
  if (led) {
    const { reportHash, ...core } = led.report;
    if (ledgerHash({ report: core, state: led.state }) !== reportHash) fail('trend_ledger_hash_mismatch');
    for (const p of led.report.postures || []) {
      if (postures[p.asset] && p.posture !== 'ABSTAIN' && postures[p.asset] !== p.posture) {
        errors.push(`posture_mismatch_vs_ledger:${p.asset}`); postures[p.asset] = 'ABSTAIN';
      }
    }
  }
  const prevRow = (await db.query('select snapshot_id,asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [EXECUTOR_VERSION])).rows[0];
  if (prevRow && String(prevRow.snapshot_id) === String(snap.id)) { duplicate = true; report = prevRow.asset_assessments.executor.report; }
  else {
    const out = planMandate({ previous: prevRow?.asset_assessments?.executor?.state || null, mandate, postures, postureAt, balances, portfolioUsd, quotes, refPrices, depthUsd, now });
    report = { ...out.report, dataErrors: errors, unvaluedCurrencies: unvalued };
    const ins = await db.query(
      'insert into learning_shadow_v2_evaluations (snapshot_id,generated_at,strategy_version,regime,consistency,asset_assessments,external_research_trigger,execution_enabled) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false) on conflict (snapshot_id,strategy_version) do nothing returning id',
      [snap.id, report.at, EXECUTOR_VERSION, JSON.stringify({ kind: 'EXECUTOR_DRY_RUN_MANDATE', action: report.action, realOrdersSent: 0 }),
        JSON.stringify({ readOnlyKey: Boolean(balances), ordersNeverSent: true }), JSON.stringify({ executor: { report, state: out.state } }),
        JSON.stringify({ required: false, mode: 'DRY_RUN', wouldSend: report.orders.length, realOrders: 0 })]);
    if (ins.rowCount !== 1) fail('unexpected_snapshot_conflict_rollback');
    saved = true;
  }
  await db.query('commit');
} catch (e) { try { await db.query('rollback'); } catch { /* keep original */ } throw e; }
finally { await db.end(); }

console.log('SHADOW_EXECUTOR=' + JSON.stringify({ ok: true, saved, duplicate, version: EXECUTOR_VERSION, mode: 'DRY_RUN', action: report.action, why: report.why,
  wouldSend: (report.orders || []).map(o => ({ book: o.book, side: o.side, major: o.major, notionalUsd: o.notionalUsd, reason: o.reason })),
  mandate: report.mandate || null, sleeves: report.sleeves || null, stopped: report.stopped ?? null,
  dataErrors: report.dataErrors || [], unvaluedCurrencies: report.unvaluedCurrencies || [], realOrdersSent: 0 }));
