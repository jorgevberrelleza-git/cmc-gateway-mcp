import assert from 'node:assert/strict';
import {buildRegimeEvidence} from '../src/learning/regime-evidence.mjs';
import {evaluateShadowV2} from '../src/learning/shadow-v2.mjs';
const t='2026-11-14T21:00:00Z';
const prices={isError:false,quote_source:'coinpaprika_public',structuredContent:{
  headers:['symbol','price','quote_symbol','source_updated_at'],
  rows:[['BTC',65000,'USD',t],['ADA',0.25,'USD',t],['AAVE',75,'USD',t]]
}};
const asset=()=>({available:true,
  venue_price_check:{available:true,material_mismatch:false},
  data_quality:{confidence_0_100:85},
  scores:{trap_risk_0_100:15,crowding_risk_0_100:10,
    spot_confirmation_0_100:75,persistent_wall_pressure_minus100_to100:0,
    microstructure_confidence_0_100:85}});
const snapshot={generated_at:t,assets:['BTC','ADA','AAVE'],quotes:prices,
  quote_provenance:{source:'coinpaprika_public'},
  market:Object.fromEntries(['global','technicals','derivatives','events','narratives'].map(s=>
    [s,{isError:true,error:'cmc_deprioritized_independent_primary'}])),
  microstructure:{assets:{BTC:asset(),ADA:asset(),AAVE:{available:false}}}};
const r=buildRegimeEvidence(snapshot);
assert.equal(r.crypto_regime.classification,'unknown');
assert.equal(r.crypto_regime.shock_risk,'unknown');
assert.equal(r.crypto_regime.market_evidence_absent,true);
assert.equal(r.crypto_regime.event_feed_available,false);
const v=evaluateShadowV2({snapshotRow:{id:20,generated_at:t,payload:snapshot,material_event:{material:false,reasons:[]}}});
assert.equal(v.assets.BTC.posture,'WAIT_PRIMARY_CATALYST_VALIDATION');
assert.equal(v.assets.BTC.position_change_allowed,false);
assert.ok(v.assets.BTC.cautions.includes('regime:macro_market_data_unavailable'));
assert.equal(v.regime.macro_gate.primary_source_verified,false);
assert.equal(v.execution_enabled,false);
console.log('paprika-first-macro-unknown-selftest: ok');