import {createLearningStore} from '../src/learning/storage.mjs';
import {auditMaterialEvents} from '../src/learning/event-noise-audit.mjs';
const store=createLearningStore();
try{
 const rows=await store.recentSnapshots(72);
 const report=auditMaterialEvents(rows);
 console.log('SHADOW_EVENT_AUDIT='+JSON.stringify(report));
}finally{await store.close();}
