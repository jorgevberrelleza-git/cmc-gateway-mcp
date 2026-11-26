// Free public CMC REST rate-limit guard. Uses only already persisted
// snapshots: no extra network requests or budget consumption.
// This is a source availability policy, NOT a trading or portfolio policy.
export const CMC_PUBLIC_RATE_POLICY=Object.freeze({
  lookback_hours:6,
  failures_to_cooldown:2,
  cooldown_hours:3,
  paid_calls_permitted:0,
  coinpaprika_fallback_unaffected:true,
  execution_enabled:false
});
function time(row){const ms=Date.parse(row?.generated_at||row?.payload?.generated_at||'');return Number.isFinite(ms)?ms:null;}
export function decideCmcPublicProbe(rows=[],{now=new Date(),enabled=false}={}){
 const at=+new Date(now);
 if(!enabled)return {attempt:true,reason:'public_rate_circuit_disabled',observed_429:0,cooldown_hours:0,version:'cmc_public_rate_circuit_v01'};
 // Find the most recent actual rate-limit response first. The consecutive
 // failure window must be anchored to that error, not to the current wall
 // clock: otherwise the older error can age out WHILE cooldown is running.
 const errors=(Array.isArray(rows)?rows:[])
   .filter(r=>time(r)!=null&&time(r)<=at)
   .filter(r=>r?.payload?.quote_provenance?.public_fallback_attempted===true &&
     r?.payload?.quote_provenance?.public_fallback_error_class==='cmc_public_http_429')
   .sort((a,b)=>time(b)-time(a));
 const latest=errors.length?time(errors[0]):null;
 const cluster=latest==null?[]:errors.filter(r=>
   latest-time(r)<=CMC_PUBLIC_RATE_POLICY.lookback_hours*3600000);
 if(cluster.length<CMC_PUBLIC_RATE_POLICY.failures_to_cooldown)
  return {attempt:true,reason:'insufficient_recent_429',observed_429:cluster.length,cooldown_hours:0,version:'cmc_public_rate_circuit_v01'};
 const remain=CMC_PUBLIC_RATE_POLICY.cooldown_hours*3600000-(at-latest);
 if(remain<=0)return {attempt:true,reason:'recovery_probe_due',observed_429:cluster.length,cooldown_hours:0,version:'cmc_public_rate_circuit_v01'};
 return {attempt:false,reason:'recent_429_cooldown',observed_429:cluster.length,cooldown_hours:Number((remain/3600000).toFixed(2)),version:'cmc_public_rate_circuit_v01'};
}
