import {extractLearningFeatures} from './features.mjs';
// Fixed, deterministic 4-hour research scenarios. NOT financial advice and
// never connected to the main Shadow ledger or execution engine.
export const DEFENSIVE_POLICY=Object.freeze({
 horizon_hours:4,min_observations:20,
 starting_usd_per_asset:1000,
 roundtrip_fee_slippage_bps:40,
 assumed_full_spread_bps:30,
 min_rebalance_gap_hours:12,
 max_execution_delay_hours:5.5,
 assets:['BTC','ADA','AAVE'],
 execution_enabled:false
});
const safe=v=>v==null||typeof v==='boolean'?null:
  Number.isFinite(Number(v))?Number(v):null;
const pct=(end,start)=>start>0?(end/start-1)*100:null;
const round=(x,d=4)=>Number.isFinite(x)?Number(x.toFixed(d)):null;
function feature(row,asset){return extractLearningFeatures(row.payload).assets?.[asset]||null;}
function ms(row){const n=Date.parse(row?.generated_at||'');return Number.isFinite(n)?n:null;}
function price(row,asset){const n=safe(feature(row,asset)?.price_usd);return n!=null&&n>0?n:null;}

// Return target exposure using only already-observed signal evidence, not a
// future price. Missing inputs preserve existing allocation (no forced trades).
export function targetDefensiveExposure(snapshot={},asset='BTC',mode='partial'){
  if(mode==='hodl')return 1;
  if(mode==='cash')return 0;
  if(!['partial','dynamic'].includes(mode))throw Error('unsupported_policy');
  const f=extractLearningFeatures(snapshot).assets?.[asset]||null;
  const spot=safe(f?.spot_confirmation),trap=safe(f?.trap_risk),
    confidence=safe(f?.microstructure_confidence),quality=safe(f?.fundamental_quality);
  if(!f||spot==null||trap==null||confidence==null||confidence<55)return null;
  const badFundamental=asset==='AAVE'&&f.fundamental_confirmation==='contradicts'&&quality!=null&&quality<=25;
  const badMicro=f.execution_gate==='BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA'||spot<35||trap>=65;
  const goodMicro=spot>=65&&trap<=35;
  if(mode==='partial'){
    if(badFundamental||badMicro)return 0.5;
    if(goodMicro && (asset!=='AAVE'||f.fundamental_confirmation==='confirms'))return 1;
    return null;
  }
  if(badFundamental)return 0.25;
  if(badMicro)return 0.5;
  if(goodMicro&&(asset!=='AAVE'||f.fundamental_confirmation==='confirms'))return 1;
  return null;
}

function metricSeries(series){
  let peak=series[0]??null, maxDrawdown=0;
  for(const equity of series){
    peak=Math.max(peak,equity);
    maxDrawdown=Math.min(maxDrawdown,100*(equity/peak-1));
  }
  return round(maxDrawdown);
}
export function simulateDefensiveAsset(rows=[],asset='BTC',mode='partial',
  {policy=DEFENSIVE_POLICY}={}){
  if(!['hodl','cash','partial','dynamic'].includes(mode))throw Error('unsupported_policy');
  const chronological=[...(Array.isArray(rows)?rows:[])]
    .filter(x=>x?.payload && ms(x)!=null && price(x,asset)!=null)
    .sort((a,b)=>ms(a)-ms(b));
  // Strict 4-hour grid, deduplicate repeated rows. Never fabricate missing prices.
  const grid=[];const minGap=policy.horizon_hours*3600000;
  for(const x of chronological)if(!grid.length||ms(x)>=ms(grid.at(-1))+minGap)grid.push(x);
  if(grid.length<2)return {
    asset,mode,observations:grid.length,status:'INSUFFICIENT_DATA',
    initial_value_usd:null,final_value_usd:null,execution_enabled:false
  };
  const initial=policy.starting_usd_per_asset;
  const p0=price(grid[0],asset);
  let quantity=mode==='cash'?0:initial/p0;
  let cash=mode==='cash'?initial:0;
  let lastRebalance=-Infinity,turnover=0,trades=0,costs=0,gaps=0;
  let lastTarget=mode==='cash'?0:1;
  const timeline=[{time:grid[0].generated_at,value_usd:initial}];
  const tradeLog=[];
  const costRate=(policy.roundtrip_fee_slippage_bps+policy.assumed_full_spread_bps)/20000;
  for(let i=0;i<grid.length-1;i++){
    const signalTime=ms(grid[i]),tradeTime=ms(grid[i+1]);
    const px=price(grid[i+1],asset);
    const h=(tradeTime-signalTime)/3600000;
    let target=targetDefensiveExposure(grid[i].payload,asset,mode);
    if(h>policy.max_execution_delay_hours){gaps++;target=null;}
    if(tradeTime-lastRebalance<policy.min_rebalance_gap_hours*3600000)target=null;
    // Switch allocation only on regime changes. Rebalancing continuously to
    // the same percentage overtrades a downtrend and fabricates unnecessary fees.
    if(target!=null&&Math.abs(target-lastTarget)<1e-9)target=null;
    if(target!=null){
      const total=cash+quantity*px;
      const targetNotional=total*target;
      let dQty=(targetNotional-quantity*px)/px;
      if(dQty>0)dQty=Math.min(dQty,cash/(px*(1+costRate)));
      if(dQty<0)dQty=Math.max(dQty,-quantity);
      const notional=Math.abs(dQty)*px;
      // No tiny dust trades; no leverage, no short and no borrowed balance.
      if(notional>Math.max(0.01,total*0.005)){
        const cost=notional*costRate;
        cash-=dQty*px+cost;quantity+=dQty;
        if(cash<0&&cash>-1e-7)cash=0;
        if(cash < -1e-7||quantity < -1e-10)throw Error('defensive_no_leverage_invariant');
        turnover+=notional;costs+=cost;trades++;lastRebalance=tradeTime;
        lastTarget=target;
        tradeLog.push({signal_at:grid[i].generated_at,executed_at:grid[i+1].generated_at,
          side:dQty>0?'paper_buy':'paper_reduce',cost_usd:round(cost,5),
          notional_usd:round(notional,4),target_weight:target});
      }
    }
    timeline.push({time:grid[i+1].generated_at,value_usd:cash+quantity*px});
  }
  const final=timeline.at(-1).value_usd, hodlFinal=initial*price(grid.at(-1),asset)/p0;
  const finalCash=mode==='cash'?initial:cash;
  return {
    asset,mode,status:grid.length>=policy.min_observations?'RESEARCH_ONLY':'INSUFFICIENT_OOS_EVIDENCE',
    observations:grid.length,window_count:grid.length-1,
    from:grid[0].generated_at,through:grid.at(-1).generated_at,
    initial_value_usd:initial,final_value_usd:round(final,4),
    hodl_same_prices_final_usd:round(hodlFinal,4),
    net_return_pct:round(pct(final,initial)),
    hodl_return_pct:round(pct(hodlFinal,initial)),
    excess_vs_hodl_pp:round(pct(final,initial)-pct(hodlFinal,initial)),
    max_drawdown_pct:metricSeries(timeline.map(v=>v.value_usd)),
    trades,turnover_usd:round(turnover,2),estimated_total_cost_usd:round(costs,4),
    final_cash_usd:round(finalCash,4),trade_log:tradeLog,
    policy_predeclared:true,signals_read_at_t_executed_at_t_plus_one:true,
    return_compounded:true,real_order_count:0,paid_ai_calls_made:0,
    execution_enabled:false
  };
}

export function evaluateDefensivePortfolio(rows=[],{policy=DEFENSIVE_POLICY,now=new Date()}={}){
 const cleaned=rows.filter(r=>ms(r)!=null&&ms(r)<=+new Date(now))
  .sort((a,b)=>ms(a)-ms(b));
 const start=Math.floor(cleaned.length*0.6);
 const outOfSample=cleaned.slice(start);
 // OOS is held out. Reset every policy's capital at the same first OOS price.
 const scenarios={};
 for(const mode of ['hodl','partial','dynamic','cash']){
   const perAsset=Object.fromEntries(policy.assets.map(asset=>[
     asset,simulateDefensiveAsset(outOfSample,asset,mode,{policy})
   ]));
   const rows=Object.values(perAsset);
   const sufficient=rows.every(x=>x.initial_value_usd!=null);
   const totalInitial=rows.reduce((a,x)=>a+(x.initial_value_usd||0),0);
   const totalFinal=rows.reduce((a,x)=>a+(x.final_value_usd||0),0);
   scenarios[mode]={mode,per_asset:perAsset,
     initial_usd:sufficient?round(totalInitial,2):null,
     final_usd:sufficient?round(totalFinal,2):null,
     net_return_pct:sufficient?round(pct(totalFinal,totalInitial)):null,
     trades:rows.reduce((a,x)=>a+(x.trades||0),0),
     estimated_costs_usd:round(rows.reduce((a,x)=>a+(x.estimated_total_cost_usd||0),0)),
     oos_sample_sufficient:rows.every(x=>x.status==='RESEARCH_ONLY')};
 }
 const benchmark=scenarios.hodl.net_return_pct;
 for(const entry of Object.values(scenarios))
   entry.alpha_vs_hodl_pp=benchmark!=null&&entry.net_return_pct!=null?
     round(entry.net_return_pct-benchmark):null;
 return {
   contract_version:'shadow_defensive_research_v0.1',
   sample_snapshots:cleaned.length,
   oos_raw_snapshots:outOfSample.length,
   oos_start:outOfSample[0]?.generated_at??null,
   scenarios,policy,
   evidence_gate:'OFFLINE_EXPLORATION_NOT_VALIDATED_FOR_TRADING',
   no_leverage:true,no_shorts:true,
   no_lookahead_signal_and_execution_separated:true,
   strategy_parameters_not_tuned_to_test:true,
   paid_ai_calls_made:0,external_calls_made:0,
   execution_enabled:false
 };
}
