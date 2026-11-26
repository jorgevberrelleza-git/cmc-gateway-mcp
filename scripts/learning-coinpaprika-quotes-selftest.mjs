import assert from 'node:assert/strict';
import { validateCoinPaprikaTicker,fetchCoinPaprikaQuotes } from '../src/coinpaprika-quotes.mjs';
import { extractLearningFeatures } from '../src/learning/features.mjs';
import { evaluateDataConsistency } from '../src/learning/data-consistency.mjs';
const now=new Date('2026-10-19T22:00:00Z');
const T=[
 {id:'btc-bitcoin',symbol:'BTC',last_updated:'2026-10-19T21:56:00Z',quotes:{USD:{price:82000,percent_change_24h:1.2}}},
 {id:'ada-cardano',symbol:'ADA',last_updated:'2026-10-19T21:53:00Z',quotes:{USD:{price:0.22,percent_change_24h:-1.0}}},
 {id:'aave-new',symbol:'AAVE',last_updated:'2026-10-19T21:54:00Z',quotes:{USD:{price:155.0,percent_change_24h:0.4}}}
];
assert.equal(validateCoinPaprikaTicker(T[2],'AAVE',{now}).price,155);
assert.throws(()=>validateCoinPaprikaTicker({...T[2],id:'aave-aave'},'AAVE',{now}),/identity_mismatch/);
assert.throws(()=>validateCoinPaprikaTicker({...T[0],last_updated:'2026-10-19T18:00:00Z'},'BTC',{now}),/stale_quote/);
assert.throws(()=>validateCoinPaprikaTicker({...T[0],quotes:{EUR:{price:99999}}},'BTC',{now}),/usd_price_missing/);
const urls=[];
const fakeFetch=async(url,options)=>{
 urls.push(url);
 assert.equal(options.method,'GET');
 assert.equal(options.redirect,'error');
 assert.ok(!Object.keys(options.headers).some(x=>/auth|key/i.test(x)));
 const id=new URL(url).pathname.split('/').at(-1);
 const ticker=T.find(t=>t.id===id);
 return {ok:!!ticker,status:ticker?200:404,headers:{get:()=>null},text:async()=>JSON.stringify(ticker)};
};
const res=await fetchCoinPaprikaQuotes({assets:['BTC','AAVE','ADA'],fetchImpl:fakeFetch,now});
assert.equal(urls.length,3);
assert.ok(urls.every(u=>u.startsWith('https://api.coinpaprika.com/v1/tickers/')));
assert.equal(res.quote_source,'coinpaprika_public');
const snapshot={assets:['BTC','AAVE','ADA'],quotes:res,microstructure:{assets:{
 BTC:{available:true,venue_price_check:{material_mismatch:true}},
 AAVE:{available:false},ADA:{available:true,venue_price_check:{material_mismatch:false}}
}}};
const parsed=extractLearningFeatures(snapshot);
assert.equal(parsed.assets.BTC.price_usd,82000);
assert.equal(parsed.assets.ADA.price_usd,0.22);
assert.equal(parsed.assets.AAVE.price_usd,155);
const consistency=evaluateDataConsistency(snapshot);
assert.ok(consistency.asset_blocks.BTC.includes('material_venue_price_mismatch'));
assert.equal(consistency.asset_blocks.BTC.includes('missing_positive_usd_price'),false);
assert.equal(consistency.asset_blocks.ADA,undefined);
await assert.rejects(()=>fetchCoinPaprikaQuotes({assets:['BTC','AAVE'],fetchImpl:fakeFetch,now}),/strict_asset_list_required/);
await assert.rejects(()=>fetchCoinPaprikaQuotes({assets:['BTC','AAVE','ADA'],fetchImpl:async u=>({ok:false,status:429}),now}),/paprika_http_429/);
console.log('coinpaprika-quotes-selftest: ok');
