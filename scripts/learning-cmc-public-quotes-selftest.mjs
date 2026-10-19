import assert from 'node:assert/strict';
import { fetchCmcPublicQuotes, normalizeCmcPublicQuotesResponse, classifyCmcQuoteFailure } from '../src/cmc-public-quotes.mjs';
import { extractLearningFeatures } from '../src/learning/features.mjs';
const assets=['BTC','ADA','AAVE'];
const cmcIds={BTC:'1',ADA:'2010',AAVE:'7278'};
const data={status:{error_code:0},data:[
 {id:1,symbol:'BTC',quote:{USD:{price:70000,percent_change_24h:1.5}}},
 {id:2010,symbol:'ADA',quote:{USD:{price:0.5}}},
 {id:7278,symbol:'AAVE',quote:{USD:{price:200}}}
]};
const res=normalizeCmcPublicQuotesResponse(data,{assets,cmcIds});
assert.equal(res.isError,false);
assert.equal(res.quote_source,'cmc_public_v3_keyless');
const features=extractLearningFeatures({assets,cmc_ids:cmcIds,quotes:res});
assert.equal(features.assets.BTC.price_usd,70000);
assert.equal(features.assets.AAVE.price_usd,200);
assert.equal(features.assets.ADA.price_usd,0.5);
assert.throws(()=>normalizeCmcPublicQuotesResponse({...data,data:data.data.slice(0,2)},{assets,cmcIds}),/coverage_incomplete/);
assert.throws(()=>normalizeCmcPublicQuotesResponse({...data,status:{error_code:1001}},{assets,cmcIds}),/api_status_error/);
assert.throws(()=>normalizeCmcPublicQuotesResponse({...data,data:data.data.map(x=>x.id===1?{...x,symbol:'ETH'}:x)},{assets,cmcIds}),/coverage_incomplete/);
assert.throws(()=>normalizeCmcPublicQuotesResponse({...data,data:data.data.map(x=>x.id===1?{...x,quote:{EUR:{price:50000}}}:x)},{assets,cmcIds}),/coverage_incomplete/);
assert.equal(classifyCmcQuoteFailure('429 Too Many Requests'),'rate_limited');
assert.equal(classifyCmcQuoteFailure('auth forbidden'),'authentication_or_entitlement');
let called=0;
const fakeFetch=async(url,opts)=>{
 called++;
 const u=new URL(url);
 assert.equal(u.origin,'https://pro-api.coinmarketcap.com');
 assert.equal(u.pathname,'/public-api/v3/cryptocurrency/quotes/latest');
 assert.equal(u.searchParams.get('convert'),'USD');
 assert.equal(u.searchParams.get('id'),'1,2010,7278');
 assert.equal(opts.method,'GET');
 assert.equal(opts.redirect,'error');
 assert.ok(!Object.keys(opts.headers).some(x=>/key|auth/i.test(x)));
 return {status:200,ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
};
const full=await fetchCmcPublicQuotes({assets,cmcIds,fetchImpl:fakeFetch});
assert.equal(called,1);
assert.equal(extractLearningFeatures({assets,cmc_ids:cmcIds,quotes:full}).assets.BTC.price_usd,70000);
let requests=0;
await assert.rejects(
 ()=>fetchCmcPublicQuotes({assets,cmcIds:{BTC:'1',ADA:'2010',AAVE:'1x'},fetchImpl:async()=>{requests++;throw new Error('network invoked');}}),
 /cmc_public_invalid_id/
);
assert.equal(requests,0);
await assert.rejects(()=>fetchCmcPublicQuotes({assets,cmcIds,fetchImpl:async()=>({ok:false,status:429})}),/http_429/);
console.log('learning-cmc-public-quotes-selftest: ok');
