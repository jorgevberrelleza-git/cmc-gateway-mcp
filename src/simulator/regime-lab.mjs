// Regime lab v0.3: train-on-past, validate-on-next-period, lock-before-2026.
// Fixed, immutable candidate policy family. No remote AI/model fitting or orders.
// 2026 is RETROSPECTIVE; earlier Time Machine runs already examined it.
import crypto from 'node:crypto';
import { runTimeMachine, createSmaPolicy, validateSeries, TIME_MACHINE_ASSETS, TIME_MACHINE_DAY_MS } from './time-machine.mjs';
import { WF_FOLDS, WF_TEST_WINDOW, WF_ASSUMPTIONS, WF_STRESS_ASSUMPTIONS } from './walk-forward.mjs';
import { REGIME_CANDIDATES, createRegimePolicy, classifyMarketRegime } from './regime-policy.mjs';

const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=x=>{throw new Error('regime_lab:'+x);};
const at=x=>Date.parse(x+'T00:00:00.000Z');
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const fixed=x=>Number(x.toFixed(5));
const REGISTRY=Object.freeze([
  ...REGIME_CANDIDATES.map(x=>Object.freeze({type:'regime',id:x.id,settings:x})),
  Object.freeze({type:'sma',id:'sma_7_30',settings:Object.freeze({fast:7,slow:30})}),
  Object.freeze({type:'sma',id:'sma_40_200',settings:Object.freeze({fast:40,slow:200})})
]);
function createPolicy(def) {
  if(def.type==='sma')return createSmaPolicy(def.settings);
  if(def.type==='regime')return createRegimePolicy(def.settings);
  fail('unknown_policy_type');
}
function window(full,from,to) {
  const a=at(from),b=at(to);
  const indexes=full.times.map((t,i)=>t>=a&&t<b?i:-1).filter(i=>i>=0);
  if(indexes.length<85)fail('short_window_'+from);
  const out={};
  for(const asset of TIME_MACHINE_ASSETS)out[asset]=indexes.map(i=>full.alignedBars[asset][i]);
  return out;
}
function metrics(report) {
  return {
    days:report.bars, netPct:report.candidate.netReturnPct,
    holdPct:report.benchmarks.hold.netReturnPct,
    alphaPp:report.alphaVsHoldPp, maxDrawdownPct:report.candidate.maxDrawdownPct,
    holdDrawdownPct:report.benchmarks.hold.maxDrawdownPct,
    drawdownReliefPp:fixed(report.candidate.maxDrawdownPct-report.benchmarks.hold.maxDrawdownPct),
    decisions:report.candidate.decisions, fills:report.candidate.fills,
    paidFeesUsd:report.candidate.paidFeesUsd
  };
}
function evaluate(series,def,options) {
  return metrics(runTimeMachine({series,policy:createPolicy(def),...options}));
}
function order(a,b) {
  // Score before any future validation or 2026 evaluation.
  return b.alphaPp-a.alphaPp || b.drawdownReliefPp-a.drawdownReliefPp ||
    b.netPct-a.netPct || a.fills-b.fills || a.id.localeCompare(b.id);
}
function makePretestHash(full) {
  const end=at('2026-01-01'), bars={};
  for(const a of TIME_MACHINE_ASSETS)bars[a]=full.alignedBars[a].filter(x=>x.openTime<end);
  if(bars.BTC.length<1400)fail('insufficient_pretest_history');
  return hash({bars,intervalMs:TIME_MACHINE_DAY_MS});
}
function lockCore(obj) {
  const {selectionHash,...rest}=obj;
  return rest;
}
function knownRegistry(selection) {
  if(JSON.stringify(selection.candidates)!==JSON.stringify(REGISTRY))fail('candidate_registry_changed');
  const selected=REGISTRY.find(p=>p.id===selection.lockedPolicy?.id);
  if(!selected || selection.lockedPolicy?.type!==selected.type)fail('unrecognized_locked_policy');
  if(JSON.stringify(selection.lockedPolicy?.settings)!==JSON.stringify(selected.settings))fail('unrecognized_settings');
  return selected;
}
function selectByTraining(scores) {
  const ranked=scores.slice().sort(order);
  return ranked[0].id;
}
export function trainValidateRegimeResearch({series,stepMs=TIME_MACHINE_DAY_MS,assumptions=WF_ASSUMPTIONS}={}) {
  if(stepMs!==TIME_MACHINE_DAY_MS)fail('only_daily_supported');
  const full=validateSeries(series,{stepMs});
  const foldReports=[];
  const candidateValidation=new Map(REGISTRY.map(p=>[p.id,[]]));
  for(const f of WF_FOLDS) {
    const train=window(full,f.trainStart,f.trainEnd),valid=window(full,f.validStart,f.validEnd);
    const trainRanking=REGISTRY.map(p=>({id:p.id,...evaluate(train,p,assumptions)})).sort(order);
    const chosen=trainRanking[0].id;
    const validation=REGISTRY.map(p=>{
      const normal=evaluate(valid,p,assumptions);
      const stress=evaluate(valid,p,{...assumptions,...WF_STRESS_ASSUMPTIONS});
      const item={id:p.id,normal,stress};
      candidateValidation.get(p.id).push(item);
      return item;
    });
    const deployed=validation.find(x=>x.id===chosen);
    foldReports.push({id:f.id,trainedBefore:f.trainEnd,validFrom:f.validStart,
      validationEndExclusive:f.validEnd,embargoDays:7,
      trainingWinner:chosen,trainingTopAlphaPp:trainRanking[0].alphaPp,
      trainedWinnerValidation:deployed.normal,trainedWinnerStress:deployed.stress,
      candidateValidation:validation
    });
  }
  const leaderboard=REGISTRY.map(p=>{
    const f=candidateValidation.get(p.id);
    const normals=f.map(x=>x.normal),stresses=f.map(x=>x.stress);
    return {
      id:p.id,type:p.type,
      positiveYears:normals.filter(x=>x.alphaPp>0).length,
      averageValidationAlphaPp:fixed(mean(normals.map(x=>x.alphaPp))),
      averageStressedAlphaPp:fixed(mean(stresses.map(x=>x.alphaPp))),
      worstMaxDrawdownPct:fixed(Math.min(...normals.map(x=>x.maxDrawdownPct))),
      meanDrawdownReliefPp:fixed(mean(normals.map(x=>x.drawdownReliefPp))),
      averageFills:fixed(mean(normals.map(x=>x.fills))),
      validation:normals
    };
  }).sort((a,b)=>b.positiveYears-a.positiveYears || b.averageValidationAlphaPp-a.averageValidationAlphaPp ||
    b.meanDrawdownReliefPp-a.meanDrawdownReliefPp || a.averageFills-b.averageFills || a.id.localeCompare(b.id));
  // Research gate deliberately difficult; failing cannot trigger auto-trading.
  const leader=leaderboard[0], winner=REGISTRY.find(x=>x.id===leader.id);
  const eligible=leader.positiveYears>=2 && leader.averageValidationAlphaPp>0 &&
    leader.averageStressedAlphaPp>=0 && leader.worstMaxDrawdownPct>=-40;
  const result={
    schema:'shadow_regime_research_v0.3',
    phase:'PRE_2026_LOCKED',
    pretestDataHash:makePretestHash(full),
    candidates:REGISTRY,
    folds:foldReports,leaderboard,
    assumptions:{...assumptions},stressAssumptions:{...WF_STRESS_ASSUMPTIONS},
    lockedPolicy:{id:winner.id,type:winner.type,settings:winner.settings,
      researchGate:eligible?'PASSED_RESEARCH_ONLY':'FAILED',realMoneyAllowed:false,
      autoPromotion:false},
    testWindow:WF_TEST_WINDOW,
    knownPreviouslyInspectedTest2026:true,
    executionEnabled:false,ordersCreated:0,policyPromoted:false,
    note:'Three forward train->validate folds. Final winner selected from 2023-2025 validations, never 2026; 2026 remains retrospective, not pristine OOS.'
  };
  result.selectionHash=hash(lockCore(result));
  return result;
}
export function assessRegime2026({series,lockedSelection,stepMs=TIME_MACHINE_DAY_MS}={}) {
  if(!lockedSelection || lockedSelection.schema!=='shadow_regime_research_v0.3')fail('selection_required');
  if(lockedSelection.selectionHash!==hash(lockCore(lockedSelection)))fail('tampered_selection');
  if(lockedSelection.phase!=='PRE_2026_LOCKED'||lockedSelection.executionEnabled!==false||
    lockedSelection.ordersCreated!==0||lockedSelection.policyPromoted!==false ||
    lockedSelection.lockedPolicy.realMoneyAllowed!==false||
    lockedSelection.lockedPolicy.autoPromotion!==false)fail('execution_or_promotion_blocked');
  if(JSON.stringify(lockedSelection.testWindow)!==JSON.stringify(WF_TEST_WINDOW))fail('test_window_tampered');
  const policy=knownRegistry(lockedSelection);
  if(stepMs!==TIME_MACHINE_DAY_MS)fail('only_daily_supported');
  const full=validateSeries(series,{stepMs});
  if(makePretestHash(full)!==lockedSelection.pretestDataHash)fail('pretest_data_drift');
  const test=window(full,WF_TEST_WINDOW.from,WF_TEST_WINDOW.to);
  const normal=evaluate(test,policy,lockedSelection.assumptions);
  const stressed=evaluate(test,policy,{...lockedSelection.assumptions,...lockedSelection.stressAssumptions});
  const counts={UNKNOWN:0,BULL:0,BEAR:0,SIDEWAYS:0,SHOCK:0};
  const btc=test.BTC;
  for(let i=0;i<btc.length;i++) {
    const r=classifyMarketRegime({btcHistory:btc.slice(0,i+1),observedThrough:btc[i].closeTime,
      config:policy.type==='regime'?policy.settings:REGIME_CANDIDATES[1]});
    counts[r.regime]++;
  }
  const result={
    schema:'shadow_regime_test_v0.3',phase:'RETROSPECTIVE_RESEARCH_ONLY',
    lockedPolicyId:policy.id,selectionHash:lockedSelection.selectionHash,
    researchGate:lockedSelection.lockedPolicy.researchGate,
    testedFrom:WF_TEST_WINDOW.from,testedEndExclusive:WF_TEST_WINDOW.to,
    test:normal,stressTest:stressed,btcRegimeDistribution:counts,
    retrospectiveOnly:true,pristineBlind:false,executionEnabled:false,
    ordersCreated:0,policyPromoted:false,
    note:'2026 used in earlier Time Machine exploratory runs. 2026 advantage does not establish predictive edge.'
  };
  result.resultHash=hash(result);
  return result;
}
export const REGIME_POLICY_REGISTRY=REGISTRY;
