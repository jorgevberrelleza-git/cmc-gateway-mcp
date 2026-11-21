#!/usr/bin/env node
// Shadow executor v0.7 runner — DRY_RUN ONLY. Never sends orders.
// Inputs: latest sealed trend-ledger postures (Postgres), Bitso public ticker,
// and (optionally) balances via a READ-ONLY Bitso key stored in Render as
// BITSO_READONLY_API_KEY / BITSO_READONLY_API_SECRET. Without a key it records
// HOLD:balances_unavailable so the pipeline is still exercised.
import pg from 'pg';
import { planExecution, EXECUTOR_BOOKS, EXECUTOR_VERSION } from '../src/learning/executor-v07.mjs';
import { makeBitsoReadOnlyClient } from '../src/learning/bitso-readonly-client.mjs';
import { ledgerHash, TREND_LEDGER_VERSION } from '../src/learning/trend-ledger-v07.mjs';

const fail = m => { throw Error('executor_runner:' + m); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL_required');
if (String(process.env.SHADOW_EXECUTION_ENABLED || 'false').toLowerCase() === 'true') {
  fail('live_execution_not_supported_in_v0.7.0'); // this build is dry-run only by construction
}
const STABLE_USD = new Set(['usd', 'usdt', 'usdc', 'usds']);
async function getJson(url, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw Error('HTTP' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function ticker(book) {
  const j = await getJson(`https://api.bitso.com/v3/ticker/?book=${book}`);
  if (!j.success) throw Error('ticker_unsuccessful');
  return { bid: +j.payload.bid, ask: +j.payload.ask };
}

const now = new Date();
const errors = [];
const quotes = {};
for (const [a, book] of Object.entries(EXECUTOR_BOOKS)) {
  try { quotes[a] = await ticker(book); } catch (e) { errors.push(`${a}:quote:${e.message}`); }
}
let balances = null, otherAssetsUsd = 0; const unvalued = [];
if (process.env.BITSO_READONLY_API_KEY && process.env.BITSO_READONLY_API_SECRET) {
  try {
    const client = makeBitsoReadOnlyClient({ key: process.env.BITSO_READONLY_API_KEY, secret: process.env.BITSO_READONLY_API_SECRET });
    balances = await client.balances();
    for (const [cur, b] of Object.entries(balances)) {
      if (!(b.total > 0) || ['usd', 'btc', 'eth'].includes(cur)) continue;
      if (STABLE_USD.has(cur)) { otherAssetsUsd += b.total; continue; }
      try { const tq = await ticker(`${cur}_usd`); otherAssetsUsd += b.total * (tq.bid + tq.ask) / 2; }
      catch { unvalued.push(cur); } // conservative: excluded from the portfolio total
    }
  } catch (e) { errors.push('balances:' + e.message); balances = null; }
} else { errors.push('balances:readonly_key_not_configured'); }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
let report = null, saved = false, duplicate = false;
await db.connect();
try {
  await db.query('begin');
  const lock = await db.query('select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired', [60017, 8]);
  if (lock.rows[0]?.acquired !== true) fail('concurrent_executor_locked');
  const snap = (await db.query('select id from learning_snapshots order by generated_at desc,id desc limit 1')).rows[0];
  if (!snap) fail('latest_snapshot_missing');
  const led = (await db.query('select asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [TREND_LEDGER_VERSION])).rows[0]?.asset_assessments?.ledger;
  let postures = [], postureAt = null;
  if (led) {
    const { reportHash, ...core } = led.report;
    if (ledgerHash({ report: core, state: led.state }) !== reportHash) fail('trend_ledger_hash_mismatch');
    postures = led.report.postures; postureAt = led.report.at;
  }
  const prevRow = (await db.query('select snapshot_id,asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [EXECUTOR_VERSION])).rows[0];
  if (prevRow && String(prevRow.snapshot_id) === String(snap.id)) { duplicate = true; report = prevRow.asset_assessments.executor.report; }
  else {
    const out = planExecution({ previous: prevRow?.asset_assessments?.executor?.state || null, postures, postureAt: postureAt || '1970-01-01T00:00:00Z', balances, otherAssetsUsd, quotes, now });
    report = { ...out.report, dataErrors: errors, unvaluedCurrencies: unvalued };
    const ins = await db.query(
      'insert into learning_shadow_v2_evaluations (snapshot_id,generated_at,strategy_version,regime,consistency,asset_assessments,external_research_trigger,execution_enabled) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false) on conflict (snapshot_id,strategy_version) do nothing returning id',
      [snap.id, report.at, EXECUTOR_VERSION,
        JSON.stringify({ kind: 'EXECUTOR_DRY_RUN', action: report.action, realOrdersSent: 0 }),
        JSON.stringify({ readOnlyKey: Boolean(balances), ordersNeverSent: true }),
        JSON.stringify({ executor: { report, state: out.state } }),
        JSON.stringify({ required: false, mode: 'DRY_RUN', wouldSend: report.orders.length, realOrders: 0 })]);
    if (ins.rowCount !== 1) fail('unexpected_snapshot_conflict_rollback');
    saved = true;
  }
  await db.query('commit');
} catch (e) { try { await db.query('rollback'); } catch { /* keep original */ } throw e; }
finally { await db.end(); }

console.log('SHADOW_EXECUTOR_V07=' + JSON.stringify({ ok: true, saved, duplicate, version: EXECUTOR_VERSION, mode: 'DRY_RUN',
  action: report.action, why: report.why, wouldSend: (report.orders || []).map(o => ({ book: o.book, side: o.side, notionalUsd: o.notionalUsd, reason: o.reason })),
  sleeve: report.sleeve || null, stopped: report.stopped ?? null, cashShortfall: report.cashShortfall ?? null,
  dataErrors: report.dataErrors || [], unvaluedCurrencies: report.unvaluedCurrencies || [], realOrdersSent: 0 }));
