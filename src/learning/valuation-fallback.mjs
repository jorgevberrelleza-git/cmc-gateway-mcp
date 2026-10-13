const COIN_IDS = {
  BTC: 'coingecko:bitcoin',
  AAVE: 'coingecko:aave',
  ADA: 'coingecko:cardano'
};

export async function fillMissingUsdPrices(prices = {}, symbols = []) {
  const out = { ...prices };
  const missing = [...new Set(symbols.map(x => String(x).toUpperCase()))]
    .filter(symbol => !(Number(out[symbol]) > 0) && COIN_IDS[symbol]);

  if (!missing.length) return { prices: out, fallback_used: false };

  const ids = missing.map(symbol => COIN_IDS[symbol]).join(',');
  const response = await fetch('https://coins.llama.fi/prices/current/' + ids, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error('valuation_fallback_http_' + response.status);

  const body = await response.json();
  for (const symbol of missing) {
    const price = Number(body?.coins?.[COIN_IDS[symbol]]?.price);
    if (Number.isFinite(price) && price > 0) out[symbol] = price;
  }

  return {
    prices: out,
    fallback_used: missing.some(symbol => Number(out[symbol]) > 0)
  };
}
