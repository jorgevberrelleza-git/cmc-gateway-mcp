import assert from 'node:assert/strict';
import { auditMaterialEvents } from '../src/learning/event-noise-audit.mjs';
const s=(material,reasons,at)=>({
 generated_at:at,
 material_event:{material,reasons}
});
const report=auditMaterialEvents([
 s(false,[],'2026-10-19T01:00:00Z'),
 s(true,['BTC:wall_delta_45'],'2026-10-19T02:00:00Z'),
 s(true,['BTC:spot_delta_-30','ADA:wall_delta_-60'],'2026-10-19T03:00:00Z'),
 s(true,['ADA:price_move_-4.23pct','ADA:spot_delta_50'],'2026-10-19T04:00:00Z'),
 s(true,['AAVE:fundamental_quality_delta_-25','BTC:trap_delta_24','BTC:spot_delta_26'],'2026-10-19T05:00:00Z')
]);
assert.equal(report.samples,5);
assert.equal(report.material_v01,4);
assert.equal(report.stricter_research_candidates,2);
assert.equal(report.context_only_under_v02,2);
assert.equal(report.estimated_queue_reduction_pct,50);
assert.equal(report.enable_queue_filter,false);
assert.equal(report.execution_enabled,false);
console.log('event-noise-audit-selftest: ok');
