import assert from 'node:assert/strict';
import {chooseQuoteRoute,resolveIndependentQuotePrimary,sourceRouteSummary} from '../src/learning/quote-routing-policy.mjs';
import {validateShadowRuntimeConfig} from '../src/learning/runtime-config.mjs';
const assets=['BTC','AAVE','ADA'];
const route=chooseQuoteRoute({mode:'paprika_first',assets});
assert.equal(route.primary,'coinpaprika_public');
assert.equal(route.cmc_allowed_only_if_primary_failed,true);
assert.equal(route.execution_enabled,false);
assert.throws(()=>chooseQuoteRoute({mode:'paprika_first',assets:['BTC','ETH','ADA']}),/requires_BTC_ADA_AAVE/);
assert.throws(()=>chooseQuoteRoute({mode:'unknown',assets}),/invalid_mode/);
assert.throws(()=>chooseQuoteRoute({mode:'paprika_first',assets:['BTC','BTC','ADA']}),/duplicate/);
let calls=0;
const quotes={quote_source:'coinpaprika_public',isError:false,structuredContent:{
  headers:['symbol','price','quote_symbol'],
  rows:[['BTC',64000,'USD'],['ADA',.25,'USD'],['AAVE',70,'USD']]
}};
const good=await resolveIndependentQuotePrimary({route,assets,fetchQuotes:async({assets:requested})=>{
  calls++;assert.equal(requested.length,3);return quotes;
}});
assert.equal(calls,1);
assert.equal(good.attempted,true);
assert.equal(good.quotes,quotes);
assert.equal(good.error_class,null);
const report=sourceRouteSummary({route,primarySucceeded:!!good.quotes});
assert.equal(report.cmc_deprioritized,true);
assert.equal(report.orders_created,0);
const noFetch=await resolveIndependentQuotePrimary({
  route:chooseQuoteRoute({mode:'cmc_first',assets}),assets,
  fetchQuotes:async()=>{throw Error('must_not_be_called')}
});
assert.equal(noFetch.attempted,false);
const missing=await resolveIndependentQuotePrimary({route,assets,fetchQuotes:async()=>({
  ...quotes,structuredContent:{headers:['symbol','price','quote_symbol'],rows:[['BTC',64000,'USD']]}
})});
assert.equal(missing.quotes,null);
assert.equal(missing.error_class,'paprika_incomplete_asset_coverage');
const bogus=await resolveIndependentQuotePrimary({route,assets,fetchQuotes:async()=>({...quotes,quote_source:'cmc_mcp'})});
assert.equal(bogus.error_class,'paprika_source_identity_mismatch');
const failed=await resolveIndependentQuotePrimary({route,assets,fetchQuotes:async()=>{throw Error('paprika_stale_quote')}});
assert.equal(failed.quotes,null);
assert.equal(failed.error_class,'paprika_stale_quote');
const unknown=await resolveIndependentQuotePrimary({route,assets,fetchQuotes:async()=>{throw Error('SECRET_API_KEY=123')}});
assert.equal(unknown.error_class,'paprika_network_unavailable');
assert.equal(JSON.stringify(unknown).includes('123'),false);
const baseline=validateShadowRuntimeConfig({LEARNING_ASSETS:'BTC,AAVE,ADA'},{requireDatabase:false});
assert.equal(baseline.normalized.quote_source_mode,'paprika_first');
assert.equal(baseline.ready_for_shadow,true,JSON.stringify(baseline.errors));
const invalid=validateShadowRuntimeConfig({LEARNING_ASSETS:'BTC,AAVE,ADA',LEARNING_QUOTE_SOURCE_MODE:'unsupported'},{requireDatabase:false});
assert.ok(invalid.errors.includes('LEARNING_QUOTE_SOURCE_MODE_invalid'));
const incompatible=validateShadowRuntimeConfig({LEARNING_ASSETS:'BTC,ADA',LEARNING_QUOTE_SOURCE_MODE:'paprika_first'},{requireDatabase:false});
assert.ok(incompatible.errors.includes('paprika_first_requires_BTC_ADA_AAVE'));
const cmc=validateShadowRuntimeConfig({LEARNING_ASSETS:'BTC,ADA',LEARNING_QUOTE_SOURCE_MODE:'cmc_first'},{requireDatabase:false});
assert.equal(cmc.errors.includes('paprika_first_requires_BTC_ADA_AAVE'),false);
console.log('quote-routing-policy-selftest: ok');