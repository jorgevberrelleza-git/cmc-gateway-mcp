import {assessEventQuality} from './event-quality-v02.mjs';

export function auditMaterialEvents(rows=[]) {
  const entries=(Array.isArray(rows)?rows:[]).filter(r=>r?.material_event);
  const samples=[];
  const familyCounts={price:0,spot:0,wall:0,trap:0,gate:0,fundamental:0,other:0};
  let material=0,strictCandidates=0,contextOnly=0;
  for(const row of entries){
    const q=assessEventQuality(row.material_event);
    if(!q.material_v01)continue;
    material++;
    if(q.research_candidate)strictCandidates++;
    else contextOnly++;
    for(const f of q.evidence_families)familyCounts[f]=(familyCounts[f]||0)+1;
    if(samples.length<8) samples.push({
      at:row.generated_at || row.material_event.current_generated_at || null,
      quality_score:q.quality_score_0_100,
      families:q.evidence_families,
      research_candidate:q.research_candidate
    });
  }
  const all=entries.length;
  return {
    contract_version:'shadow_event_noise_audit_v0.1',
    samples:all,
    material_v01:material,
    material_rate_pct:all?Number((100*material/all).toFixed(1)):null,
    stricter_research_candidates:strictCandidates,
    context_only_under_v02:contextOnly,
    estimated_queue_reduction_pct:material?Number((100*contextOnly/material).toFixed(1)):null,
    family_counts:familyCounts,
    examples:samples,
    interpretation:'Counterfactual classification only; existing event, queue, HOLD and trading policies unchanged',
    enable_queue_filter:false,
    execution_enabled:false
  };
}
