import {createLearningStore} from '../src/learning/storage.mjs';
import {evaluateWalkforward} from '../src/learning/walkforward-v01.mjs';
const store=createLearningStore();
try {
 const now=new Date();
 const hours=Math.min(24*21,Math.max(24*5,Number(process.env.LEARNING_WALKFORWARD_HOURS||336)));
 const start=new Date(now.getTime()-hours*3600000);
 const rows=await store.snapshotsBetween(start.toISOString(),now.toISOString(),5000);
 const report=evaluateWalkforward(rows,{now});
 console.log('SHADOW_WALKFORWARD_SUMMARY='+JSON.stringify(report));
} finally {await store.close();}
