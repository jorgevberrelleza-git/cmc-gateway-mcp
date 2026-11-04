import { createGroqResearchCanary } from '../src/learning/groq-research-canary.mjs';
const started=Date.now();
const allowed=String(process.env.LEARNING_GROQ_CANARY_ENABLED||'false').toLowerCase()==='true';
const canary=createGroqResearchCanary({enabled:allowed});
const observation={asset:'BTC',observed_at:new Date().toISOString(),facts:[
  'Synthetic test: BTC spot and derivatives information have not been independently verified.',
  'Synthetic test: venue liquidity and bid/ask spread are unavailable.',
  'Synthetic test: no market news or directional signal is attested.'
]};
try{
 const r=await canary.analyze(observation);
 console.log('SHADOW_GROQ_CANARY='+JSON.stringify({
  ok:r.ok===true,skipped:r.skipped===true,reason:r.reason||null,
  provider:r.provider||null,model:r.model||null,
  complete_schema:Boolean(r.analysis&&r.analysis.summary&&r.analysis.gaps&&r.analysis.risks),
  confidence:r.analysis?.confidence||null,
  notes:r.analysis?.summary||null,
  risk_count:r.analysis?.risks?.length||0,gap_count:r.analysis?.gaps?.length||0,
  duration_ms:Date.now()-started,
  synthetic_input:true,authorizes_position_change:false,execution_enabled:false
 }));
}catch(error){
 console.log('SHADOW_GROQ_CANARY='+JSON.stringify({
  ok:false,reason:String(error?.message||error).slice(0,120),
  duration_ms:Date.now()-started,synthetic_input:true,
  authorizes_position_change:false,execution_enabled:false
 }));
 process.exitCode=1;
}
