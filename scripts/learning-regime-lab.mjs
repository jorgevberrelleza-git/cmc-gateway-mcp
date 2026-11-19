#!/usr/bin/env node
// Opt-in standalone research CLI. No imports from Render cron, database, Bitso or AI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSyntheticHistory,loadHistoryManifest } from '../src/simulator/history.mjs';
import { trainValidateRegimeResearch,assessRegime2026 } from '../src/simulator/regime-lab.mjs';
import { runHistoricalEventStudy } from '../src/simulator/event-study.mjs';

const args=process.argv.slice(2);
const opt=(prefix,fallback=null)=>{const x=args.find(a=>a.startsWith(prefix+'='));return x?x.slice(prefix.length+1):fallback;};
const demo=args.includes('--demo'),manifest=opt('--manifest');
if(Number(demo)+Number(Boolean(manifest))!==1)throw Error('Specify --demo xor --manifest=manifest.json');
const stage=opt('--stage','select');
if(!['select','test','event'].includes(stage))throw Error('Invalid stage');
const root=path.resolve(process.cwd(),opt('--root','data/time-machine'));
const data=demo?{
  series:buildSyntheticHistory({days:2130,from:Date.UTC(2021,0,1)}),
  intervalMs:86400000,datasetId:'SYNTHETIC_NOT_MARKET',provenance:{}
}:await loadHistoryManifest({root,manifest});
const output=path.resolve(process.cwd(),'artifacts/time-machine');
await fs.mkdir(output,{recursive:true});
const locked=path.join(output,'regime-selection-lock.json');
let summary;
if(stage==='select') {
  const selection=trainValidateRegimeResearch({series:data.series,stepMs:data.intervalMs});
  await fs.writeFile(locked,JSON.stringify({
    datasetId:data.datasetId,synthetic:demo,provenance:data.provenance,selection
  },null,2)+'\n',{mode:0o600});
  summary={
    candidates:selection.candidates.length,folds:selection.folds.length,
    years:selection.folds.map(f=>f.id),chosen:selection.lockedPolicy.id,
    researchedGate:selection.lockedPolicy.researchGate,
    meanValidationAlphaPp:selection.leaderboard[0].averageValidationAlphaPp,
    validationYearsPositive:selection.leaderboard[0].positiveYears,
    selectionHash:selection.selectionHash,report:'artifacts/time-machine/regime-selection-lock.json'
  };
}else if(stage==='test') {
  const l=JSON.parse(await fs.readFile(locked,'utf8'));
  if(l.datasetId!==data.datasetId||l.synthetic!==demo||
    JSON.stringify(l.provenance)!==JSON.stringify(data.provenance))throw Error('regime_lab:dataset_mismatch');
  const result=assessRegime2026({series:data.series,stepMs:data.intervalMs,lockedSelection:l.selection});
  await fs.writeFile(path.join(output,'regime-test-2026.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  summary={
    chosen:result.lockedPolicyId,researchGate:result.researchGate,
    candidateNetPct:result.test.netPct,holdNetPct:result.test.holdPct,
    alphaPp:result.test.alphaPp,maxDrawdownPct:result.test.maxDrawdownPct,
    stressedAlphaPp:result.stressTest.alphaPp,fills:result.test.fills,
    btcRegimes:result.btcRegimeDistribution,report:'artifacts/time-machine/regime-test-2026.json'
  };
}else{
  const eventId=opt('--event','SPACEX_IPO_20260612');
  const result=runHistoricalEventStudy({series:data.series,stepMs:data.intervalMs,eventId});
  await fs.writeFile(path.join(output,'event-'+eventId+'.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  summary={
    eventId,status:result.statisticalStatus,controlCount:result.controlsCount||0,
    btc:result.assets?.BTC||null,ada:result.assets?.ADA||null,aave:result.assets?.AAVE||null,
    report:'artifacts/time-machine/event-'+eventId+'.json'
  };
}
console.log('SHADOW_REGIME_LAB_'+stage.toUpperCase()+'='+JSON.stringify({
  ok:true,datasetId:data.datasetId,synthetic:demo,...summary,
  policyPromoted:false,executionEnabled:false,realOrders:0,
  notice:'Research only. No model authorized to operate real money.'
}));
