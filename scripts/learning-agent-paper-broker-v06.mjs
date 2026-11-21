#!/usr/bin/env node
// Shadow v0.6 paper broker: SERIALIZED and TRANSACTIONAL account journal.
// No Bitso private endpoints, real balances or order APIs.
// Read previous account, decide, and append under ONE advisory transaction lock.
import crypto from 'node:crypto';
import pg from 'pg';
import { runAgentPaperCycle, PAPER_BROKER_VERSION } from '../src/learning/agent-broker-paper-v06.mjs';
import { AUTONOMY_CONTROL_VERSION } from '../src/learning/autonomy-control-v05.mjs';

const { Client } = pg;
const hash=x=>{
  const stable=y=>Array.isArray(y)?y.map(stable):y&&typeof y==='object'
    ?Object.fromEntries(Object.keys(y).sort().map(k=>[k,stable(y[k])])):y;
  return crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
};
const fail=m=>{throw Error('paper_broker:'+m);};
if(!process.env.DATABASE_URL)fail('DATABASE_URL_required');
const db=new Client({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.PGSSL==='disable'?false:undefined
});
const now=new Date();
let report=null,saved=false,duplicate=false;
await db.connect();
try{
  await db.query('begin');
  // A second paper worker must not reuse the same previous state.
  // Transaction-scoped, nonblocking lock, released on COMMIT or ROLLBACK.
  const lock=await db.query(
    'select pg_try_advisory_xact_lock($1::integer,$2::integer) as acquired',
    [60017,6]
  );
  if(lock.rows[0]?.acquired!==true)fail('concurrent_paper_worker_locked');
  const latest=await db.query(
    'select id,generated_at,payload from learning_snapshots order by generated_at desc,id desc limit 1'
  );
  const snapshot=latest.rows[0];
  if(!snapshot)fail('latest_snapshot_missing');
  const currentControl=await db.query(
    'select asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 and snapshot_id=$2 order by id desc limit 1',
    [AUTONOMY_CONTROL_VERSION,snapshot.id]
  );
  const control=currentControl.rows[0]?.asset_assessments?.control||null;
  if(!control)fail('signed_control_missing_for_current_snapshot');
  const mostRecent=await db.query(
    'select snapshot_id,generated_at,asset_assessments from learning_shadow_v2_evaluations where strategy_version=$1 order by id desc limit 1',
    [PAPER_BROKER_VERSION]
  );
  const old=mostRecent.rows[0]?.asset_assessments?.broker||null;
  if(old){
    const {reportHash,...core}=old;
    if(typeof reportHash!=='string'||reportHash!==hash(core))
      fail('previous_record_hash_mismatch');
    if(String(old.snapshotId)===String(snapshot.id)){
      duplicate=true;
      report=old;
    }
  }
  if(!duplicate){
    report=runAgentPaperCycle({
      control,currentRow:snapshot,previousState:old?.state||null,
      now,incidentState:'UNKNOWN'
    });
    if(report.status==='DUPLICATE_NO_CHANGE')
      fail('unexplained_state_duplicate_missing_persisted_row');
    const inserted=await db.query(
      'insert into learning_shadow_v2_evaluations (snapshot_id,generated_at,strategy_version,regime,consistency,asset_assessments,external_research_trigger,execution_enabled) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false) on conflict (snapshot_id,strategy_version) do nothing returning id',
      [
        snapshot.id,report.generatedAt,PAPER_BROKER_VERSION,
        JSON.stringify({
          kind:'OFFLINE_BROKER_SIMULATION',globalMode:report.globalMode,
          controlHash:report.controlAuditHash,reportHash:report.reportHash,
          realOrders:0,executionEnabled:false
        }),
        JSON.stringify({
          simOnly:true,pricingModel:report.dataModel,
          noCurrentBarFills:true,feesAndSlippageApplied:true,
          externalIncidentStatus:'UNKNOWN',
          accountUpdateAtomic:true
        }),
        JSON.stringify({broker:report}),
        JSON.stringify({
          required:false,mode:'NO_LIVE_ROUTER',
          intendedPaperOrders:report.submittedPaperIntents.length,
          filledPaperOrders:report.fills.length,realOrders:0
        })
      ]
    );
    if(inserted.rowCount!==1)fail('unexpected_snapshot_conflict_rollback');
    saved=true;
  }
  await db.query('commit');
  console.log('SHADOW_PAPER_BROKER_V06='+JSON.stringify({
    ok:true,saved,duplicate,
    version:PAPER_BROKER_VERSION,
    controlHash:report.controlAuditHash||null,
    snapshotId:String(snapshot.id),
    mode:report.globalMode||'DUPLICATE',
    status:report.status,
    assetModes:report.assetDecisions?.map(x=>({asset:x.asset,mode:x.mode}))||[],
    paperOrdersProposed:report.submittedPaperIntents?.length||0,
    paperOrdersFilled:report.fills?.length||0,
    paperPending:report.paperAccount?.outstandingPaperOrders??null,
    globalStopReasons:report.globalStopReasons||[],
    haltLatched:report.paperAccount?.haltLatched??null,
    haltReason:report.paperAccount?.haltReason||null,
    recoveryEvent:report.recoveryEvent?.type||null,
    paperCashUsd:report.paperAccount?.cashUsd??null,
    paperEquityUsd:report.paperAccount?.equityUsd??null,
    serializedStateTransaction:true,
    proxyPricingNotBitso:true,realOrders:0,
    realExecutionEnabled:false,bitsoApiCalls:0
  }));
}catch(error){
  try{await db.query('rollback');}catch{/* original error wins */}
  throw error;
}finally{
  await db.end();
}
