#!/usr/bin/env node
// M0/M1 Shadow paper broker, research DB ONLY. No Bitso credentials/orders.
// Each snapshot produces one append-only journal. All fills use NEXT snapshot
// with conservative synthetic USD proxy spread/slippage, NOT Bitso executable quotes.
import crypto from 'node:crypto';
import { createLearningStore } from '../src/learning/storage.mjs';
import { runAgentPaperCycle, PAPER_BROKER_VERSION } from '../src/learning/agent-broker-paper-v06.mjs';
import { AUTONOMY_CONTROL_VERSION } from '../src/learning/autonomy-control-v05.mjs';

const store=createLearningStore();
const now=new Date();
const hash=x=>{
  const stable=y=>Array.isArray(y)?y.map(stable):y&&typeof y==='object'
    ?Object.fromEntries(Object.keys(y).sort().map(k=>[k,stable(y[k])])):y;
  return crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
};
try {
  const [snapshots,evaluations] = await Promise.all([
    store.recentSnapshots(2),
    store.listShadowV2Evaluations({
      from:new Date(+now-40*86400000).toISOString(),
      to:now.toISOString(),limit:10000
    })
  ]);
  const snapshot=snapshots[0];
  if(!snapshot)throw Error('paper_broker:no_snapshot');
  const latestControl=evaluations.filter(x=>
    x.strategy_version===AUTONOMY_CONTROL_VERSION &&
    String(x.snapshot_id)===String(snapshot.id)
  ).at(-1)?.asset_assessments?.control;
  if(!latestControl)throw Error('paper_broker:control_for_current_snapshot_missing');
  const latestPaperRow=evaluations.filter(x=>x.strategy_version===PAPER_BROKER_VERSION).at(-1);
  const previousPaper=latestPaperRow?.asset_assessments?.broker||null;
  if(previousPaper){
    const {reportHash,...core}=previousPaper;
    if(typeof reportHash!=='string'||reportHash!==hash(core))
      throw Error('paper_broker:previous_report_hash_mismatch');
  }
  // Incident guard still needs independent official status attestations.
  // UNKNOWN is not interpreted as CLEAR; this is only a paper experiment.
  const report=runAgentPaperCycle({
    control:latestControl,currentRow:snapshot,
    previousState:previousPaper?.state||null,now,incidentState:'UNKNOWN'
  });
  let saved=false;
  if(report.status!=='DUPLICATE_NO_CHANGE') {
    saved=Boolean(await store.saveShadowV2Evaluation({
      snapshot_id:snapshot.id,
      generated_at:report.generatedAt,
      strategy_version:PAPER_BROKER_VERSION,
      regime:{
        kind:'OFFLINE_BROKER_SIMULATION',globalMode:report.globalMode,
        controlHash:report.controlAuditHash,
        reportHash:report.reportHash,
        realOrders:0,executionEnabled:false
      },
      consistency:{
        simOnly:true,pricingModel:report.dataModel,
        noCurrentBarFills:true,feesAndSlippageApplied:true,
        externalIncidentStatus:'UNKNOWN'
      },
      assets:{broker:report},
      external_research_trigger:{
        required:false,mode:'NO_LIVE_ROUTER',
        intendedPaperOrders:report.submittedPaperIntents.length,
        filledPaperOrders:report.fills.length,
        realOrders:0
      }
    }));
  }
  console.log('SHADOW_PAPER_BROKER_V06='+JSON.stringify({
    ok:true,saved,
    duplicate:report.status==='DUPLICATE_NO_CHANGE'||!saved,
    version:PAPER_BROKER_VERSION,controlHash:report.controlAuditHash||null,
    snapshotId:String(snapshot.id),mode:report.globalMode||'DUPLICATE',
    status:report.status,assetModes:report.assetDecisions?.map(x=>({asset:x.asset,mode:x.mode}))||[],
    paperOrdersProposed:report.submittedPaperIntents?.length||0,
    paperOrdersFilled:report.fills?.length||0,
    paperPending:report.paperAccount?.outstandingPaperOrders??null,
    paperCashUsd:report.paperAccount?.cashUsd??null,
    paperEquityUsd:report.paperAccount?.equityUsd??null,
    proxyPricingNotBitso:true,realOrders:0,
    realExecutionEnabled:false,bitsoApiCalls:0
  }));
} finally {
  await store.close();
}
