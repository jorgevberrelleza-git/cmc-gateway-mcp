import assert from 'node:assert/strict';
import { extractLearningFeatures, extractUsdPrices, quoteExtractionDiagnostics } from '../src/learning/features.mjs';
import { evaluateDataConsistency } from '../src/learning/data-consistency.mjs';
function wrap(data) {
  return {structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}]};
}
const assets=['BTC','ADA','AAVE'],ids={BTC:'1',ADA:'2010',AAVE:'7278'};
const base={assets,cmc_ids:ids,generated_at:'2026-10-18T12:00:00Z',microstructure:{assets:{
 BTC:{available:true,venue_price_check:{material_mismatch:true}},
 ADA:{available:true,venue_price_check:{material_mismatch:false}},
 AAVE:{available:false}
}}};
function validate(quotes) {
 return extractLearningFeatures({...base,quotes});
}
// 1: Multi-representation table from MCP must preserve symbol/price.
const table={headers:['id','symbol','price','percent_change_24h'],rows:[
  ['1','BTC',70000,1.2],['2010','ADA',0.62,-2],['7278','AAVE',200,3]
]};
const t=validate(wrap(table));
assert.equal(t.assets.BTC.price_usd,70000);
assert.equal(t.assets.AAVE.price_usd,200);
assert.equal(t.assets.ADA.pct_24h,-2);
assert.equal(quoteExtractionDiagnostics({...base,quotes:wrap(table)}).parsed_rows,3);
// 2: CMC /v2 id-keyed quote object with explicit USD, some without symbol.
const keyed={data:{
 '1':{id:1,symbol:'BTC',quote:{USD:{price:70200,percent_change_24h:1.8}}},
 '2010':{id:2010,quote:{USD:{price:0.63,percent_change_24h:-1.1}}},
 '7278':{id:7278,symbol:'AAVE',quote:{USD:{price:205}}}
}};
const k=validate(wrap(keyed));
assert.equal(k.assets.BTC.price_usd,70200);
assert.equal(k.assets.ADA.price_usd,0.63);
assert.equal(k.assets.AAVE.price_usd,205);
// 3: One side structured, other side text-only table; honor valid structured rows.
const dual={structuredContent:{data:keyed.data},content:[{type:'text',text:JSON.stringify(table)}]};
assert.equal(validate(dual).assets.BTC.price_usd,70200);
// 4: If structured representation is incomplete, explicit text version can fill.
const incomplete={structuredContent:{headers:['symbol','price'],rows:[['BTC',70400]]},
 content:[{type:'text',text:JSON.stringify(table)}]};
assert.equal(validate(incomplete).assets.AAVE.price_usd,200);
// 5: No alternate currency silently promoted to USD.
const nonUsd={data:{'1':{id:1,symbol:'BTC',quote:{EUR:{price:75000}}}}};
assert.equal(validate(wrap(nonUsd)).assets.BTC.price_usd,null);
// 6: Missing, invalid, zero, null and negative values must not pass.
for(const price of [null,0,-2,'',NaN]){
 const quote={headers:['symbol','price'],rows:[['BTC',price]]};
 assert.equal(validate(wrap(quote)).assets.BTC.price_usd,null);
}
// 7: Even with a valid primary price, venue mismatch still blocks.
const consistency=evaluateDataConsistency({...base,quotes:wrap(table)});
assert.ok(consistency.asset_blocks.BTC.includes('material_venue_price_mismatch'));
assert.ok(!consistency.asset_blocks.BTC.includes('missing_positive_usd_price'));
assert.equal(consistency.blocking,true);
// 8: Bitso-only USD midpoint works for observational returns, never entry approval.
const venueOnly={...base,quotes:{isError:true},microstructure:{assets:{
 BTC:{available:true,minor_currency:'usd',order_book:{mid:71000}}
}}};
assert.equal(extractUsdPrices(venueOnly).BTC,71000);
assert.equal(evaluateDataConsistency(venueOnly).asset_blocks.BTC[0],'missing_positive_usd_price');
console.log('learning-quote-parser-selftest: ok');
