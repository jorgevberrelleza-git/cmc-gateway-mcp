// Deterministic source-health gate: avoid pounding a broken/free-tier MCP.
// Uses only historical snapshots available BEFORE the current collection.
// A cooldown is not a source repair. REST and independent sources remain usable.
const FAILURES_TO_OPEN=3;
const COOLDOWN_MS=6*60*60*1000;
function timestamp(row){const t=Date.parse(row?.generated_at || row?.payload?.generated_at || '');return Number.isFinite(t)?t:null;}
function priorAttempt(row){
  const p=row?.payload?.quote_provenance;
  if(!p)return false;
  if(p.mcp_probe_attempted===true)return true;
  if(p.mcp_probe_attempted===false)return false;
  return p.mcp_failure_class!=null || p.source==='cmc_mcp'; // historic snapshots
}
function failed(row){
  const p=row?.payload?.quote_provenance;
  return p?.mcp_failure_class!=null && p?.source!=='cmc_mcp';
}
export function decideCmcMcpProbe(recent=[],{now=new Date(),enabled=true}={}){
  const moment=+new Date(now);
  const valid=(Array.isArray(recent)?recent:[]).filter(r=>timestamp(r)!=null&&timestamp(r)<=moment)
    .sort((a,b)=>timestamp(b)-timestamp(a));
  const attempts=valid.filter(priorAttempt);
  const lastThree=attempts.slice(0,FAILURES_TO_OPEN);
  if(!enabled)return {attempt:true,reason:'circuit_disabled',cooldown_hours:0,consecutive_failures:0,version:'cmc_mcp_circuit_v01'};
  if(lastThree.length<FAILURES_TO_OPEN || !lastThree.every(failed)){
    return {attempt:true,reason:'not_enough_consecutive_failures',cooldown_hours:0,consecutive_failures:lastThree.filter(failed).length,version:'cmc_mcp_circuit_v01'};
  }
  const latest=timestamp(lastThree[0]);
  const elapsed=moment-latest;
  if(elapsed>=COOLDOWN_MS){
    return {attempt:true,reason:'scheduled_recovery_probe',cooldown_hours:0,consecutive_failures:3,version:'cmc_mcp_circuit_v01'};
  }
  return {attempt:false,reason:'recent_upstream_failures',cooldown_hours:Number(((COOLDOWN_MS-elapsed)/3600000).toFixed(2)),consecutive_failures:3,version:'cmc_mcp_circuit_v01'};
}
export const CMC_MCP_CIRCUIT_POLICY=Object.freeze({
  minimum_failed_attempts:FAILURES_TO_OPEN,
  recovery_probe_hours:6,
  paid_calls_permitted:0,
  rest_and_independent_fallbacks_unaffected:true,
  execution_enabled:false
});
