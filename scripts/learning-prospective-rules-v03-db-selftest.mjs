import assert from 'node:assert/strict';
import {createLearningStore} from '../src/learning/storage.mjs';
import {FORWARD_RULES_V03} from '../src/learning/prospective-rules-v03.mjs';
const store=createLearningStore();
try {
 const latest=await store.latestSnapshot();
 assert.ok(latest?.id,'latest snapshot required');
 const r=await store.pool.query(
  'select snapshot_id,strategy_version,asset_assessments,execution_enabled,external_research_trigger from learning_shadow_v2_evaluations where strategy_version=$1 and snapshot_id=$2',
  [FORWARD_RULES_V03.version,latest.id]
 );
 assert.equal(r.rows.length,1,'unique prospective evaluation per snapshot and policy');
 assert.equal(r.rows[0].execution_enabled,false);
 assert.equal(r.rows[0].external_research_trigger.execute_external_calls,false);
 for(const item of Object.values(r.rows[0].asset_assessments||{})){
  assert.equal(item.action,'HOLD');
  assert.equal(item.position_change_allowed,false);
  assert.equal(item.order_proposal_allowed,false);
  assert.equal(item.execution_enabled,false);
 }
 console.log('learning-prospective-rules-v03-db-selftest: ok');
}finally{await store.close();}
