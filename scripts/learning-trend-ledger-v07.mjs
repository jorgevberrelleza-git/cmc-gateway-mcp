#!/usr/bin/env node
// Shadow v0.7 trend ledger runner — PAPER ONLY, hourly.
// Reads: Kraken public daily OHLC (closed candles, SMA200) and Bitso public
// ticker (bid/ask). Writes: one row per snapshot in learning_shadow_v2_evaluations
// under strategy_version = TREND_LEDGER_VERSION, inside one advisory-locked
// transaction. No private keys, no order endpoints, no real money.
import pg from 'pg';
import { trendPosture, TREND_FILTER_UNIVERSE } from '../src/learning/trend-filter-v07.mjs';
import { stepTrendLedger, ledgerHash, TREND_LEDGER_VERSION } from '../src/learning/trend-ledger-v07.mjs';

const KRAKEN = { BTC: 'XBTUSD', ETH: 'ETHUSD' };
const BITSO = { BTC: 'btc_usd', ETH: 'eth_usd' };
const fail = m => { throw Error('trend_ledger_runner:' + m); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL_required');

async function getJson(url, ms = 8000) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'shadow-research/0.7' } });
    if (!r.ok) throw Error('HTTP' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function dailyCandles(asset) {
  const j = await getJson(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[asset]}&interval=1440`);
  if (j.error?.length) throw Error('kraken:' + j.error.join(','));
  const rows = Object.entries(j.result).find(([k]) => k !== 'last')?.[1];
  if (!Array.isArray(rows)) throw Error('kraken_payload');
  return rows.map(k => ({ t: k[0] * 1000, close: +k[4] })); // trendPosture drops the still-open day
}
async function bitsoQuote(asset) {
  const j = await getJson(`https://api.bitso.com/v3/ticker/?book=${BITSO[asset]}`);
  if (!j.success) throw Error('bitso_unsuccessful');
  return { bid: +j.payload.bid, ask: +j.payload.ask, at: j.payload.created_at };
}

const now = new Date();
const postures = [], quotes = {}, dataErrors = [];
for (const asset of TREND_FILTER_UNIVERSE) {
  try { postures.push(trendPosture({ asset, candles: await dailyCandles(asset), now })); }
  catch (e) { dataErrors.push(`${asset}:candles:${e.message}`); postures.push({ asset, posture: 'ABSTAIN', reason: 'candles_unavailable' }); }
  try { quotes[asset] = await bitsoQuote(asset); }
  catch (e) { dataErrors.push(`${asset}:quote:${e.message}`); }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
let out = null, saved = false, duplicate = false;
await db.connect();
try {
  await db.query('begin');
  const lock = await db.query('select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired', [60017, 7]);
  if (lock.rows[0]?.acquired !== true) fail('concurrent_trend_ledger_locked');
  const snap = (await db.query('select id from learning_snapshots order by generated_at desc,id desc limit 1')).rows[0];
  if (!snap) fail('latest_snapshot_missing');
  const prevRow = (await db.query('select snapshot_id,asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [TREND_LEDGER_VERSION])).rows[0];
  const prev = prevRow?.asset_assessments?.ledger || null;
  const sealed = (report, state) => { const { reportHash, ...core } = report; return ledgerHash({ report: core, state }); };
  if (prev && sealed(prev.report, prev.state) !== prev.report?.reportHash) fail('previous_ledger_hash_mismatch');
  if (prevRow && String(prevRow.snapshot_id) === String(snap.id)) { duplicate = true; out = prev.report; }
  else {
    const { state, report } = stepTrendLedger({ previous: prev?.state || null, postures, quotes, now });
    report.dataErrors = dataErrors;
    report.reportHash = sealed(report, state); // seal AFTER all fields are set
    const ins = await db.query(
      'insert into learning_shadow_v2_evaluations (snapshot_id,generated_at,strategy_version,regime,consistency,asset_assessments,external_research_trigger,execution_enabled) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false) on conflict (snapshot_id,strategy_version) do nothing returning id',
      [snap.id, report.at, TREND_LEDGER_VERSION,
        JSON.stringify({ kind: 'TREND_FILTER_PAPER_LEDGER', postures: report.postures, realOrders: 0, executionEnabled: false }),
        JSON.stringify({ simOnly: true, pricing: report.pricing, closedDailyCandlesOnly: true, limitsMeasuredNotEnforced: true }),
        JSON.stringify({ ledger: { report, state } }),
        JSON.stringify({ required: false, mode: 'NO_LIVE_ROUTER', action: report.action, realOrders: 0 })]);
    if (ins.rowCount !== 1) fail('unexpected_snapshot_conflict_rollback');
    saved = true; out = report;
  }
  await db.query('commit');
} catch (e) { try { await db.query('rollback'); } catch { /* keep original */ } throw e; }
finally { await db.end(); }

console.log('SHADOW_TREND_LEDGER_V07=' + JSON.stringify({ ok: true, saved, duplicate, version: TREND_LEDGER_VERSION,
  postures: out.postures, action: out.action, why: out.why, fills: out.fills?.length || 0, marks: out.marks,
  wouldHalt: out.wouldHalt, dataErrors: out.dataErrors || [], realOrders: 0, realExecutionEnabled: false }));
