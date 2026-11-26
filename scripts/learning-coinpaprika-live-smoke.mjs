import { fetchCoinPaprikaQuotes } from '../src/coinpaprika-quotes.mjs';
import { extractLearningFeatures } from '../src/learning/features.mjs';
const assets=['BTC','ADA','AAVE'];
try{
 const quotes=await fetchCoinPaprikaQuotes({assets});
 const prices=extractLearningFeatures({assets,quotes}).assets;
 console.log(JSON.stringify({
  ok:true,source:quotes.quote_source,
  asset_usd_prices:Object.fromEntries(assets.map(asset=>[asset,prices[asset].price_usd])),
  verification_time:new Date().toISOString(),execution_enabled:false
 }));
}catch(e){
 console.error(JSON.stringify({ok:false,reason:String(e?.message||e).slice(0,100),execution_enabled:false}));
 process.exitCode=1;
}
