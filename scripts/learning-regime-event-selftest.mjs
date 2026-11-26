import assert from 'node:assert/strict';
import { buildSyntheticHistory } from '../src/simulator/history.mjs';
import { runTimeMachine } from '../src/simulator/time-machine.mjs';
import { classifyMarketRegime,createRegimePolicy,REGIME_CANDIDATES,REGIMES } from '../src/simulator/regime-policy.mjs';
import { trainValidateRegimeResearch,assessRegime2026,REGIME_POLICY_REGISTRY } from '../src/simulator/regime-lab.mjs';
import { runHistoricalEventStudy,VERIFIED_EVENT_CATALOG } from '../src/simulator/event-study.mjs';

const data=buildSyntheticHistory({days:2130,from:Date.UTC(2021,0,1)});
const c=REGIME_CANDIDATES[1];
assert.equal(classifyMarketRegime({btcHistory:data.BTC.slice(0,44),
  observedThrough:data.BTC[43].closeTime,config:c}).regime,'UNKNOWN');
const firstKnown=classifyMarketRegime({btcHistory:data.BTC.slice(0,210),
  observedThrough:data.BTC[209].closeTime,config:c});
assert.ok(REGIMES.includes(firstKnown.regime));
assert.throws(()=>classifyMarketRegime({btcHistory:data.BTC.slice(0,211),
  observedThrough:data.BTC[209].closeTime,config:c}),/future_data_detected/);
assert.throws(()=>createRegimePolicy({...c,btcFast:0}),/window_out_of_bounds/);
const engine=runTimeMachine({series:data,policy:createRegimePolicy(c)});
assert.ok(engine.candidate.audit.decisions.every(x=>!x.earliestFill||Date.parse(x.earliestFill)>Date.parse(x.observedThrough)));
assert.equal(engine.executionEnabled,false);
assert.equal(engine.executedRealOrders,0);

const selection=trainValidateRegimeResearch({series:data});
assert.equal(selection.candidates.length,REGIME_POLICY_REGISTRY.length);
assert.equal(selection.folds.length,3);
assert.deepEqual(selection.folds.map(x=>x.id),['2023','2024','2025']);
assert.equal(selection.lockedPolicy.realMoneyAllowed,false);
assert.equal(selection.lockedPolicy.autoPromotion,false);
assert.equal(selection.executionEnabled,false);
assert.equal(selection.ordersCreated,0);
assert.equal(selection.policyPromoted,false);

// Changing ONLY 2026 must not affect the winner, any fold or pretest hash.
const changed=structuredClone(data);
const limit=Date.UTC(2026,0,1);
for(const a of ['BTC','ADA','AAVE'])for(const b of changed[a]) {
  if(b.openTime<limit)continue;
  const days=(b.openTime-limit)/86400000;
  const factor=0.36+days*0.004;
  for(const key of ['open','high','low','close'])b[key]*=factor;
}
const other=trainValidateRegimeResearch({series:changed});
assert.equal(other.selectionHash,selection.selectionHash);
assert.equal(other.lockedPolicy.id,selection.lockedPolicy.id);
assert.deepEqual(other.leaderboard,selection.leaderboard);
const test=assessRegime2026({series:data,lockedSelection:selection});
const alt=assessRegime2026({series:changed,lockedSelection:selection});
assert.notEqual(alt.resultHash,test.resultHash);
assert.equal(alt.selectionHash,test.selectionHash);
assert.equal(test.pristineBlind,false);
assert.equal(test.executionEnabled,false);
assert.equal(test.ordersCreated,0);
assert.equal(test.policyPromoted,false);
const forged=structuredClone(selection);
forged.lockedPolicy.id='sma_1_2';
assert.throws(()=>assessRegime2026({series:data,lockedSelection:forged}),/tampered_selection/);
const shifted=structuredClone(data);
shifted.BTC[5].open*=0.99;
shifted.BTC[5].high*=0.99;
shifted.BTC[5].low*=0.99;
shifted.BTC[5].close*=0.99;
assert.throws(()=>assessRegime2026({series:shifted,lockedSelection:selection}),/pretest_data_drift/);

const spacex=runHistoricalEventStudy({series:data});
assert.equal(spacex.statisticalStatus,'DESCRIPTIVE_NON_CAUSAL');
assert.ok(spacex.controlsCount>=8);
assert.equal(spacex.cryptoDay0CandleIncludesPreAndPostListing,true);
assert.equal(spacex.equityReturnsSimulated,false);
assert.equal(spacex.IPOExecutionSimulated,false);
assert.equal(spacex.liveExecution,false);
assert.ok(VERIFIED_EVENT_CATALOG.some(x=>x.id==='SPACEX_IPO_20260612'));
const post2026=runHistoricalEventStudy({series:data,eventId:'ANTHROPIC_IPO_20261119'});
assert.equal(post2026.statisticalStatus,'INSUFFICIENT_OBSERVED_OUTCOMES');
assert.equal(post2026.eventInDataset,false);
assert.equal(post2026.liveExecution,false);
assert.throws(()=>runHistoricalEventStudy({series:data,eventId:'FAKE_IPO'}),/not_whitelisted/);
const missing=structuredClone(data);
missing.AAVE.splice(10,1);
assert.throws(()=>runHistoricalEventStudy({series:missing}),/gap_or_duplicate/);

console.log('SHADOW_REGIME_EVENT_SELFTEST='+JSON.stringify({
  ok:true,policyCandidates:selection.candidates.length,folds:selection.folds.length,
  lockedPolicy:selection.lockedPolicy.id,
  selectionIndependentOf2026:true,causalClosedBarBtcContext:true,
  futureBarRejected:true,lockTamperRejected:true,
  sourcePretestDriftRejected:true,spacexControlCount:spacex.controlsCount,
  anthropicFutureReturnsBlocked:true,realOrders:0,executionEnabled:false
}));
