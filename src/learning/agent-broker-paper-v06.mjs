// Shadow Agent + Paper Broker v0.6 — STRICTLY SIMULATED.
// Consumes existing v0.5 signed research control and v0.4 24/72h forecasts.
// No Bitso, network, API key, order method, real balance or real-money execution.
// Fills are priced on NEXT saved snapshot with explicit USD proxy costs.
// Not a real venue model. Claims of achieved return / skill are forbidden.
import crypto from 'node:crypto';
import { AUTONOMY_CONTROL_VERSION, SUPPORTED_ASSETS } from './autonomy-control-v05.mjs';
import { priceFromSnapshot } from './prospective-forecast-v04.mjs';

const stable = x => Array.isArray(x)?x.map(stable):x && typeof x==='object'
  ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const fail=m=>{throw Error('paper_broker:'+m);};
const at=x=>{const n=Date.parse(x||'');return Number.isFinite(n)?n:null;};
const finite=x=>{const n=Number(x);return (x===null||x===undefined||x===''||!Number.isFinite(n))?null:n;};
const r=x=>Number(x.toFixed(8));
export const PAPER_BROKER_VERSION='shadow_agent_paper_v0.6';
export const PAPER_MODES=Object.freeze(['HALT','DEFENSIVE','LIQUIDITY','OPERATE_PAPER']);
export const PAPER_BROKER_LIMITS=Object.freeze({
  initialUsd:10000,feeBps:10,assumedSpreadBps:20,assumedSlippageBps:15,
  maxNewOrderEquityFraction:0.05,maxAssetWeight:0.20,
  maxTotalExposure:0.60,minCashWeight:0.40,
  maxDayLossPct:2,maxDrawdownPct:10,
  minOrderUsd:15
});
function checkPolicy(p) {
  const k=['initialUsd','feeBps','assumedSpreadBps','assumedSlippageBps','maxNewOrderEquityFraction',
    'maxAssetWeight','maxTotalExposure','minCashWeight','maxDayLossPct','maxDrawdownPct','minOrderUsd'];
  if(k.some(x=>finite(p?.[x])==null))fail('bad_risk_config');
  if(p.initialUsd<=0||p.feeBps<0||p.feeBps>200||p.assumedSpreadBps<0||p.assumedSpreadBps>250||
     p.assumedSlippageBps<0||p.assumedSlippageBps>300||p.maxNewOrderEquityFraction<=0||
     p.maxNewOrderEquityFraction>0.05||p.maxAssetWeight<=0||p.maxAssetWeight>0.2||
     p.maxTotalExposure<=0||p.maxTotalExposure>0.6||p.minCashWeight<0.4||
     p.minCashWeight>=1||p.maxDayLossPct>2||p.maxDayLossPct<=0||
     p.maxDrawdownPct>10||p.maxDrawdownPct<=0||p.minOrderUsd<1)fail('unsafe_risk_config');
}
export function verifyControl(control) {
  if(!control || control.version!==AUTONOMY_CONTROL_VERSION || !/^[a-f0-9]{64}$/.test(control.auditHash||''))return false;
  const {auditHash,...original}=control;
  return sha(original)===auditHash &&
    control.realMoneyReady===false &&
    control.executionEnabled===false &&
    control.orderRouterConnected===false &&
    control.positionChangesAllowed===false &&
    control.realOrdersCreated===0;
}
export function initialPaperState({capitalUsd=PAPER_BROKER_LIMITS.initialUsd,atTime=null}={}){
  if(!Number.isFinite(capitalUsd)||capitalUsd<=0||capitalUsd>100000)fail('bad_seed_capital');
  return {
    version:PAPER_BROKER_VERSION,model:'USD_PROXY_NOT_EXECUTABLE_IN_BITSO',
    initialUsd:capitalUsd,cashUsd:capitalUsd,
    positions:Object.fromEntries(SUPPORTED_ASSETS.map(a=>[a,0])),
    peakEquityUsd:capitalUsd,dayStartEquityUsd:capitalUsd,
    dayUtc:atTime?String(atTime).slice(0,10):null,latestEquityUsd:capitalUsd,
    pending:[],recentFills:[],cumulativeFeesUsd:0,filledOrders:0,
    lastControlHash:null,lastSnapshotId:null,lastEvaluatedAt:null,
    liveBrokerConnected:false,realOrders:0
  };
}
function cleanState(s){
  if(s?.version!==PAPER_BROKER_VERSION||s.model!=='USD_PROXY_NOT_EXECUTABLE_IN_BITSO'||
    s.liveBrokerConnected!==false||s.realOrders!==0)fail('unsafe_or_unknown_previous_state');
  if(s.initialUsd<=0||!Number.isFinite(s.initialUsd)||!Number.isFinite(s.cashUsd)||s.cashUsd < -1e-7||
     !Number.isFinite(s.latestEquityUsd)||s.latestEquityUsd<0||!Number.isFinite(s.peakEquityUsd)||
     s.peakEquityUsd<=0||!Number.isFinite(s.dayStartEquityUsd)||s.dayStartEquityUsd<=0 ||
     !Array.isArray(s.pending)||s.pending.length>3||!Array.isArray(s.recentFills))fail('corrupt_paper_state');
  if(SUPPORTED_ASSETS.some(a=>!Number.isFinite(s.positions?.[a])||s.positions[a]<-1e-9))fail('negative_or_missing_positions');
  return structuredClone(s);
}
function mark(state,qs){
  let assetsUsd=0,complete=true;
  for(const a of SUPPORTED_ASSETS) {
    const units=state.positions[a];
    if(units>0 && (!qs[a]?.valid||!(qs[a].priceUsd>0)))complete=false;
    if(units>0 && qs[a]?.valid)assetsUsd+=units*qs[a].priceUsd;
  }
  return {
    complete,equityUsd:complete?state.cashUsd+assetsUsd:null,
    assetValueUsd:complete?assetsUsd:null
  };
}
function eligibleLimits(state,prices,policy){
  const m=mark(state,prices);
  if(!m.complete||!Number.isFinite(m.equityUsd)||m.equityUsd<=0)return {halt:true,reason:'portfolio_valuation_invalid'};
  const utc=prices.currentUtc;
  const dayBase=state.dayUtc===utc?state.dayStartEquityUsd:state.latestEquityUsd;
  const peak=Math.max(state.peakEquityUsd,m.equityUsd);
  const dayLoss=Math.max(0,100*(dayBase-m.equityUsd)/dayBase);
  const drawdown=Math.max(0,100*(peak-m.equityUsd)/peak);
  return {
    halt:dayLoss>=policy.maxDayLossPct||drawdown>=policy.maxDrawdownPct,
    reason:dayLoss>=policy.maxDayLossPct?'daily_loss_limit':drawdown>=policy.maxDrawdownPct?'total_drawdown_limit':null,
    dayLossPct:r(dayLoss),drawdownPct:r(drawdown),
    equityUsd:m.equityUsd,peakEquityUsd:peak,dayStartEquityUsd:dayBase
  };
}
function chooseAssetMode(x,state,forecastVerified,halt) {
  if(halt)return {mode:'HALT',reason:'global_safety_halt',action:null};
  if(!x?.sourceQualityPassed || !(x.quoteUsd>0))return {mode:'HALT',reason:'invalid_quote',action:null};
  const units=state.positions[x.asset]||0;
  const risks=x.riskFamilies||[];
  const strongRisk=x.researchPosture==='DEFENSIVE_REVIEW' &&
    risks.length>=2;
  if(strongRisk)return {mode:'DEFENSIVE',reason:'multi_factor_risk_readout',
    action:units>0?'SELL_PAPER':null};
  const h=x.forecast||{};
  const confirmedRecovery=x.researchPosture==='RECOVERY_RESEARCH' &&
    x.forwardResearchSignal?.startsWith('RECOVERY_WATCH') &&
    x.venueVerified===true && forecastVerified &&
    h['24h']?.direction==='UP' && h['72h']?.direction==='UP' &&
    risks.length===0;
  if(confirmedRecovery)return {mode:'OPERATE_PAPER',reason:'multi_factor_recovery_experiment',
    action:'BUY_PAPER'};
  return {mode:'LIQUIDITY',reason:'edge_unproven_or_mixed_signals',action:null};
}
// No oracle or current-bar execution: pending orders fill only at a later saved
// quote timestamp. Venue and order-book are NOT claimed to be verified.
function attemptPaperFill({intent,state,prices,currentSnapshotTime,policy}){
  if(!['BUY_PAPER','SELL_PAPER'].includes(intent?.action)||!SUPPORTED_ASSETS.includes(intent.asset))
    return {status:'REJECTED',reason:'invalid_intent'};
  if(at(intent.issuedAt)==null||currentSnapshotTime<=at(intent.issuedAt))
    return {status:'PENDING',reason:'await_next_snapshot'};
  if(currentSnapshotTime-at(intent.issuedAt)>3*3600000)
    return {status:'EXPIRED',reason:'quote_after_three_hours'};
  const q=prices[intent.asset];
  if(!q?.valid||!(q.priceUsd>0))return {status:'PENDING',reason:'future_quote_invalid'};
  const slip=policy.assumedSlippageBps/10000,halfSpread=policy.assumedSpreadBps/20000,
    feeRate=policy.feeBps/10000;
  const price=q.priceUsd*(intent.action==='BUY_PAPER'?1+slip+halfSpread:1-slip-halfSpread);
  if(!(price>0))return {status:'REJECTED',reason:'nonpositive_price'};
  const equity=mark(state,prices).equityUsd;
  if(!(equity>0))return {status:'REJECTED',reason:'unvalued_portfolio'};
  const notionalHoldings=Object.fromEntries(SUPPORTED_ASSETS.map(a=>[a,state.positions[a]*prices[a].priceUsd]));
  const exposed=Object.values(notionalHoldings).reduce((a,b)=>a+b,0);
  let units=0,cashChange=0,fee=0;
  if(intent.action==='BUY_PAPER'){
    const budget=Math.min(intent.maxNotionalUsd,
      equity*policy.maxNewOrderEquityFraction,
      state.cashUsd-equity*policy.minCashWeight,
      equity*policy.maxAssetWeight-notionalHoldings[intent.asset],
      equity*policy.maxTotalExposure-exposed
    );
    if(budget<policy.minOrderUsd)return {status:'REJECTED',reason:'risk_budget_or_min_cash_not_satisfied'};
    units=budget/(price*(1+feeRate));
    fee=units*price*feeRate;
    cashChange=-(units*price+fee);
    if(state.cashUsd+cashChange < -1e-8)return {status:'REJECTED',reason:'negative_cash'};
  } else {
    units=Math.min(state.positions[intent.asset],finite(intent.units)||0);
    if(!(units>0))return {status:'REJECTED',reason:'no_position_to_reduce'};
    fee=units*price*feeRate;
    cashChange=units*price-fee;
  }
  state.cashUsd=r(state.cashUsd+cashChange);
  state.positions[intent.asset]=r(state.positions[intent.asset]+(intent.action==='BUY_PAPER'?units:-units));
  state.cumulativeFeesUsd=r(state.cumulativeFeesUsd+fee);
  state.filledOrders++;
  const fill={
    orderId:intent.id,asset:intent.asset,side:intent.action==='BUY_PAPER'?'BUY':'SELL',
    issuedAt:intent.issuedAt,filledAt:new Date(currentSnapshotTime).toISOString(),
    units:r(units),executionPriceUsd:r(price),
    referencePriceUsd:r(q.priceUsd),notionalUsd:r(units*price),
    feeUsd:r(fee),slippageBps:policy.assumedSlippageBps,
    spreadBps:policy.assumedSpreadBps,
    source:q.source,executionVenue:'USD_PROXY_RESEARCH_ONLY',realOrder:false
  };
  state.recentFills=[...(state.recentFills||[]),fill].slice(-40);
  return {status:'FILLED',fill};
}
export function runAgentPaperCycle({
  control,currentRow,previousState=null,now=new Date(),
  incidentState='UNKNOWN',riskPolicy=PAPER_BROKER_LIMITS
}={}){
  checkPolicy(riskPolicy);
  const nowMs=+new Date(now);
  if(!Number.isFinite(nowMs))fail('invalid_now');
  if(!verifyControl(control))fail('unverified_control_audit');
  if(!currentRow?.id||String(currentRow.id)!==String(control.snapshotId))
    fail('control_snapshot_mismatch');
  const rowTs=at(currentRow.generated_at),sourceTs=at(currentRow.payload?.generated_at),
    controlTs=at(control.generatedAt);
  if(rowTs==null||sourceTs==null||controlTs==null||
    Math.max(rowTs,sourceTs,controlTs)>nowMs||controlTs<Math.max(rowTs,sourceTs))
    fail('clock_or_control_not_causal');
  if(!['UNKNOWN','CLEAR_VERIFIED','INCIDENT_VERIFIED'].includes(incidentState))fail('invalid_incident_state');
  const state=previousState?cleanState(previousState):initialPaperState({atTime:control.generatedAt});
  if(state.lastSnapshotId===String(currentRow.id))
    return {status:'DUPLICATE_NO_CHANGE',state,commands:[],fills:[],liveOrders:0,executionEnabled:false};
  if(state.lastEvaluatedAt && at(state.lastEvaluatedAt)>=controlTs)fail('non_monotonic_control');
  const quotes=Object.fromEntries(SUPPORTED_ASSETS.map(a=>[a,
    priceFromSnapshot(currentRow,a,{now:nowMs})]));
  quotes.currentUtc=new Date(nowMs).toISOString().slice(0,10);
  const dataTrusted=control.dataFresh===true &&
    control.overallDataQualityPassed===true &&
    control.runtime?.stable===true &&
    control.forecastReceipt?.integrity===true;
  const stale=nowMs-Math.max(rowTs,sourceTs)>110*60000;
  const globalEmergency=!dataTrusted||stale||incidentState==='INCIDENT_VERIFIED';
  const quotesComplete=SUPPORTED_ASSETS.every(a=>quotes[a].valid===true);
  // Risk preflight MUST happen BEFORE settling yesterday's pending order:
  // a price shock cannot execute an old buy and only then trigger HALT.
  let limits=quotesComplete?eligibleLimits(state,quotes,riskPolicy):
    {halt:true,reason:'missing_valid_market_quote',equityUsd:null,dayLossPct:null,drawdownPct:null};
  let globalHalt=globalEmergency||!quotesComplete||limits.halt;
  const filled=[],unfilled=[];
  if(!globalHalt) {
    for(const intent of state.pending) {
      const res=attemptPaperFill({
        intent,state,prices:quotes,currentSnapshotTime:Math.max(rowTs,sourceTs),policy:riskPolicy
      });
      if(res.status==='FILLED')filled.push(res.fill);
      else if(res.status==='PENDING')unfilled.push(intent);
    }
  }
  state.pending=globalHalt?[]:unfilled; // all pending canceled on incident/data failure
  if(!globalHalt)limits=eligibleLimits(state,quotes,riskPolicy);
  globalHalt ||=limits.halt;
  if(globalHalt)state.pending=[];
  const all=SUPPORTED_ASSETS.map(asset=>{
    const x={...(control.assets?.[asset]||{}),asset};
    const mode=chooseAssetMode(x,state,control.forecastReceipt?.available===true,
      globalHalt||!quotes[asset].valid);
    const blockReasons=[...(x.evidenceGaps||[])];
    return {asset,mode:mode.mode,reason:mode.reason,action:mode.action,
      evidenceGaps:blockReasons,venueVerified:x.venueVerified===true};
  });
  const commands=[];
  if(!globalHalt)for(const d of all) {
    if(!d.action)continue;
    const asset=d.asset,position=state.positions[asset];
    // Only one new unfilled pending order per asset, ever.
    if(state.pending.some(x=>x.asset===asset))continue;
    let units=null;
    if(d.action==='SELL_PAPER'){
      if(position<=0)continue;
      units=r(position*0.25); // gradual defense, NEVER forced liquidation
    }
    const maxNotionalUsd=d.action==='BUY_PAPER'?
      Math.max(0,Math.min((limits.equityUsd||state.initialUsd)*0.05,
        state.cashUsd-(limits.equityUsd||state.initialUsd)*riskPolicy.minCashWeight)):
      null;
    if(d.action==='BUY_PAPER'&&!(maxNotionalUsd>=riskPolicy.minOrderUsd))continue;
    const intent={
      id:sha({kind:PAPER_BROKER_VERSION,snapshotId:String(currentRow.id),
        asset,action:d.action,issuedAt:control.generatedAt}).slice(0,32),
      snapshotId:String(currentRow.id),asset,action:d.action,
      issuedAt:control.generatedAt,referencePriceUsd:quotes[asset].priceUsd,
      units,maxNotionalUsd,reason:d.reason,
      orderRouter:'SIMULATED_ONLY',cannotExecuteRealOrders:true
    };
    commands.push(intent);
    state.pending.push(intent);
  }
  const m=quotesComplete?mark(state,quotes):{complete:false,equityUsd:null};
  if(m.complete) {
    state.peakEquityUsd=Math.max(state.peakEquityUsd,m.equityUsd);
    if(state.dayUtc!==quotes.currentUtc){
      state.dayStartEquityUsd=limits.dayStartEquityUsd??state.latestEquityUsd;
      state.dayUtc=quotes.currentUtc;
    }
    state.latestEquityUsd=r(m.equityUsd);
  }
  state.lastControlHash=control.auditHash;
  state.lastSnapshotId=String(currentRow.id);
  state.lastEvaluatedAt=control.generatedAt;
  const report={
    version:PAPER_BROKER_VERSION,status:globalHalt?'HALT':'PAPER_RESEARCH_ACTIVE',
    snapshotId:String(currentRow.id),controlAuditHash:control.auditHash,
    observedAt:new Date(Math.max(rowTs,sourceTs)).toISOString(),
    generatedAt:control.generatedAt,
    globalMode:globalHalt?'HALT':
      all.some(x=>x.mode==='DEFENSIVE')?'DEFENSIVE':
      all.some(x=>x.mode==='OPERATE_PAPER')?'OPERATE_PAPER':'LIQUIDITY',
    globalStopReasons:globalHalt?
      [!dataTrusted?'quality_or_runtime_fail':null,stale?'stale_snapshot':null,
       incidentState==='INCIDENT_VERIFIED'?'verified_incident':null,
       !quotesComplete?'missing_quote':null,limits.reason].filter(Boolean):[],
    incidentState,assetDecisions:all,
    submittedPaperIntents:commands,fills:filled,
    paperAccount:{
      initialUsd:state.initialUsd,cashUsd:state.cashUsd,positions:state.positions,
      equityUsd:m.equityUsd,peakEquityUsd:state.peakEquityUsd,
      unrealizedReturnPct:m.complete?r(100*(m.equityUsd/state.initialUsd-1)):null,
      dayLossPct:limits.dayLossPct??null,drawdownPct:limits.drawdownPct??null,
      outstandingPaperOrders:state.pending.length,filledOrders:state.filledOrders,
      paidFeesUsd:state.cumulativeFeesUsd
    },
    dataModel:'USD_PROXY_NOT_EXECUTABLE_IN_BITSO',
    riskPolicy,
    state,
    provenance:{feeds:['shadow_v0.2','forward_v0.3','prospective_v0.4','control_v0.5'],
      geoImpactAttested:false,GroqTradingAuthority:false,
      timeMachineStrategyPromoted:false,venueExecutionVerified:false},
    noRealCredentials:true,realOrdersCreated:0,brokerApiCalls:0,
    realExecutionAllowed:false,policyPromoted:false
  };
  report.reportHash=sha(report);
  return report;
}
