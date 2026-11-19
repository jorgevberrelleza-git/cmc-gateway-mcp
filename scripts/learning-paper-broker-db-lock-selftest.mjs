#!/usr/bin/env node
// Isolated PostgreSQL integration contract: prove a second worker cannot
// acquire the paper-account journal lock until the first commits or rolls back.
// CI uses a disposable Postgres service. NEVER points at live user database.
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client }=pg;
const url=process.env.PAPER_LOCK_TEST_DATABASE_URL;
if(!url||!url.includes('localhost'))throw Error('paper_lock_test:localhost_test_database_required');
const mk=()=>new Client({connectionString:url});
const a=mk(),b=mk();
await Promise.all([a.connect(),b.connect()]);
const lock=async c=>{
  const r=await c.query('select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired',[60017,6]);
  return r.rows[0]?.acquired===true;
};
try{
  await a.query('begin');
  assert.equal(await lock(a),true,'first paper worker must own transaction lock');
  await b.query('begin');
  assert.equal(await lock(b),false,'overlapping worker must fail closed');
  await a.query('rollback');
  assert.equal(await lock(b),true,'released lock should become available after rollback');
  await b.query('commit');
  await a.query('begin');
  assert.equal(await lock(a),true,'lock must be reusable on the next cycle');
  await a.query('commit');
  console.log('SHADOW_PAPER_TRANSACTION_LOCK_SELFTEST='+JSON.stringify({
    ok:true,exclusive:true,overlapRejected:true,
    rollbackReleases:true,commitReleases:true,
    productionDatabaseUsed:false,realOrders:0
  }));
}finally{
  await Promise.allSettled([a.query('rollback'),b.query('rollback')]);
  await Promise.allSettled([a.end(),b.end()]);
}
