import {createLearningStore} from '../src/learning/storage.mjs';
import {planShadowSkillWork} from '../src/learning/skill-orchestrator.mjs';
const store=createLearningStore();
try{
  const recent=await store.recentSnapshots(120);
  const report=planShadowSkillWork(recent,{now:new Date()});
  console.log('SHADOW_SKILLS_DAILY='+JSON.stringify(report));
}finally{await store.close();}
