#!/usr/bin/env node
// Shadow paper competition runner — PAPER ONLY, hourly. Kraken public data only.
// One row per snapshot in learning_shadow_v2_evaluations (strategy_version = ROTATION_VERSION),
// inside one advisory-locked transaction. No keys, no order endpoints, no real money.
import pg from 'pg';
import { assetSignal, stepRotationPaper, ROTATION_UNIVERSE, ROTATION_VERSION } from '../src/learning/rotation-paper-v01.mjs';

const KRAKEN = { BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD', XRP: 'XRPUSD', ADA: 'ADAUSD', AAVE: 'AAVEUSD' };
const fail = m => { throw Error('rotation_paper:' + m); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL_required');
async function getJson(url, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'shadow-research/rotation-0.1' } }); if (!r.ok) throw Error('HTTP' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const now = new Date(), signals = [], lastPx = {}, dataErrors = [];
for (const a of ROTATION_UNIVERSE) {
  try {
    const j = await getJson(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[a]}&interval=1440`);
    if (j.error?.length) throw Error(j.error.join(','));
    const rows = Object.entries(j.result).find(([k]) => k !== 'last')?.[1];
    signals.push(assetSignal({ asset: a, candles: rows.map(k => ({ t: k[0] * 1000, close: +k[4] })), now }));
  } catch (e) { dataErrors.push(`${a}:candles:${e.message}`); signals.push({ asset: a, posture: 'ABSTAIN', reason: 'candles_unavailable' }); }
  try {
    const j = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${KRAKEN[a]}`);
    if (j.error?.length) throw Error(j.error.join(','));
    const v = Number(Object.values(j.result)[0]?.c?.[0]); if (!(v > 0)) throw Error('bad_last'); lastPx[a] = v;
  } catch (e) { dataErrors.push(`${a}:last:${e.message}`); }
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
let report = null, saved = false, duplicate = false;
await db.connect();
try {
  await db.query('begin');
  const lock = await db.query('select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired', [60017, 9]);
  if (lock.rows[0]?.acquired !== true) fail('concurrent_rotation_locked');
  const snap = (await db.query('select id from learning_snapshots order by generated_at desc,id desc limit 1')).rows[0];
  if (!snap) fail('latest_snapshot_missing');
  const prevRow = (await db.query('select snapshot_id,asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1', [ROTATION_VERSION])).rows[0];
  if (prevRow && String(prevRow.snapshot_id) === String(snap.id)) { duplicate = true; report = prevRow.asset_assessments.rotation.report; }
  else {
    const out = stepRotationPaper({ previous: prevRow?.asset_assessments?.rotation?.state || null, signals, lastPx, now });
    report = { ...out.report, dataErrors: [...(out.report.dataErrors || []), ...dataErrors] };
    if (out.state) {
      const ins = await db.query(
        'insert into learning_shadow_v2_evaluations (snapshot_id,generated_at,strategy_version,regime,consistency,asset_assessments,external_research_trigger,execution_enabled) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false) on conflict (snapshot_id,strategy_version) do nothing returning id',
        [snap.id, report.at, ROTATION_VERSION, JSON.stringify({ kind: 'ROTATION_PAPER_COMPETITION', realOrders: 0, executionEnabled: false }),
          JSON.stringify({ simOnly: true, pricing: 'kraken_last_plus_0.42pct_per_side', closedDailyCandlesOnly: true }),
          JSON.stringify({ rotation: { report, state: out.state } }), JSON.stringify({ required: false, mode: 'PAPER', realOrders: 0 })]);
      if (ins.rowCount !== 1) fail('unexpected_snapshot_conflict_rollback');
      saved = true;
    }
  }
  await db.query('commit');
} catch (e) { try { await db.query('rollback'); } catch { /* keep original */ } throw e; }
finally { await db.end(); }
console.log('SHADOW_ROTATION=' + JSON.stringify({ ok: true, saved, duplicate, ...report, realOrders: 0 }));
