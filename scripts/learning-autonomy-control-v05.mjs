#!/usr/bin/env node
// Aggregated, append-only research readiness record. Never places any order.
// Called AFTER collecting new quotes, forward rules and prospective forecasts.
import { createLearningStore } from '../src/learning/storage.mjs';
import { buildAutonomyControl, AUTONOMY_CONTROL_VERSION, SUPPORTED_ASSETS } from '../src/learning/autonomy-control-v05.mjs';
import { FORECAST_VERSION } from '../src/learning/prospective-forecast-v04.mjs';

const store=createLearningStore();
const now=new Date();
try {
  const from=new Date(+now-90*86400000).toISOString();
  const [snapshots,evaluations,marks,cycles] = await Promise.all([
    store.recentSnapshots(2),
    store.listShadowV2Evaluations({from,to:now.toISOString(),limit:10000}),
    store.recentPortfolioMarks(1),
    store.recentRuntimeCycles(12)
  ]);
  if(!snapshots.length)throw Error('autonomy_control:latest_snapshot_missing');
  const forecastRecord=evaluations.filter(x=>x.strategy_version===FORECAST_VERSION).at(-1);
  const prospectiveForecast=forecastRecord?.asset_assessments?.forecast??null;
  const scored=evaluations.filter(x=>x.strategy_version?.startsWith('shadow_prospective_score_v0.4_'));
  const report=buildAutonomyControl({
    currentRow:snapshots[0],previousRow:snapshots[1]||null,now,
    prospectiveForecast,prospectiveScoreRows:scored,
    latestPortfolioMark:marks[0]||null,recentRuntimeCycles:cycles,
    // UNVERIFIED is always passed explicitly. The GEO scanner does not
    // independently attest the market effect of events; no Bitso integration.
    independentMarketImpactEvidence:null,
    brokerExecutionAttestation:null,
    operationalIncidentAttestation:null,
    portfolioReconciliation:null,
    prospectiveNetAlphaAttestation:null
  });
  const saved=await store.saveShadowV2Evaluation({
    snapshot_id:snapshots[0].id,
    generated_at:report.generatedAt,
    strategy_version:AUTONOMY_CONTROL_VERSION,
    regime:{
      kind:'read_only_autonomy_committee',version:AUTONOMY_CONTROL_VERSION,
      generatedAt:report.generatedAt,realMoneyReady:false,executionEnabled:false,
      auditHash:report.auditHash
    },
    consistency:{score:report.dataConsistencyScore,passed:report.overallDataQualityPassed,
      quoteAgeMinutes:report.snapshotAgeMinutes},
    assets:{control:report},
    external_research_trigger:{required:report.blockers.length>0,
      mode:'OFFLINE_RESEARCH_ONLY',tasks:report.priorities.map(x=>x.id),
      ordersCreated:0,executionEnabled:false}
  });
  const summary={
    ok:true,saved:Boolean(saved),duplicate:!saved,
    version:AUTONOMY_CONTROL_VERSION,snapshotId:report.snapshotId,
    generatedAt:report.generatedAt,auditHash:report.auditHash,
    quoteAgeMinutes:report.snapshotAgeMinutes,
    runtimeStable:report.runtime.stable,
    forecastIntegrity:report.forecastReceipt.integrity,
    forecastsIssued:report.forecastReceipt.available,
    matured24hPredictions:report.prospectiveScorecard['24h'].evaluated,
    prospectiveScorecard:report.prospectiveScorecard,
    portfolioAlphaVsHoldPct:report.simulatedPortfolio.alphaVsHodlPct,
    marketImpactAttested:false,brokerOrderRouterConnected:false,
    evidenceBlockers:report.blockers,
    assetResearch:Object.fromEntries(SUPPORTED_ASSETS.map(a=>[a,{
      posture:report.assets[a].researchPosture,
      signal:report.assets[a].forwardResearchSignal,
      venueVerified:report.assets[a].venueVerified,
      evidenceGapCount:report.assets[a].evidenceGaps.length
    }])),
    realMoneyReady:false,executionEnabled:false,orderCount:0,
    paidAiCalls:0,externalMarketCalls:0
  };
  console.log('SHADOW_AUTONOMY_V05='+JSON.stringify(summary));
} finally {await store.close();}
