import { extractUsdPrices } from '../src/learning/features.mjs';
import { fillMissingUsdPrices } from '../src/learning/valuation-fallback.mjs';
import { replayLedger, markLedgerState } from '../src/learning/portfolio-ledger.mjs';
import { valueHodlBenchmark, buildPortfolioBenchmark } from '../src/learning/benchmark.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

function seedFromLedger(events) {
  const seedEvents = events.filter(x => x.event_type === 'seed');
  const seed = { cash_usd: 0, positions: {} };
  const seedPrices = {};
  for (const e of seedEvents) {
    if (String(e.symbol).toUpperCase() === 'USD') seed.cash_usd += Number(e.cash_delta_usd || 0);
    else {
      const symbol = String(e.symbol || '').toUpperCase();
      seed.positions[symbol] = (seed.positions[symbol] || 0) + Number(e.quantity_delta || 0);
      if (Number.isFinite(Number(e.reference_price_usd))) seedPrices[symbol] = Number(e.reference_price_usd);
    }
  }
  return { seed, seedPrices };
}

const store = createLearningStore();

try {
  const events = await store.ledgerEvents();
  if (!events.length) throw new Error('portfolio ledger is empty; run learning:portfolio:seed first');

  const latest = await store.latestSnapshot();
  if (!latest) throw new Error('no snapshot available for portfolio mark');
  const extractedPrices = extractUsdPrices(latest.payload || {});
  const resolved = await fillMissingUsdPrices(extractedPrices, Object.keys(replayLedger(events).positions || {}));
  const prices = resolved.prices;
  const state = replayLedger(events);
  const marked = markLedgerState(state, prices);

  const { seed, seedPrices } = seedFromLedger(events);
  const initialValue = valueHodlBenchmark(seed, seedPrices);
  const hodlValue = valueHodlBenchmark(seed, prices);
  const previousMarks = await store.recentPortfolioMarks(1000);
  const peak = Math.max(initialValue, ...previousMarks.map(x => Number(x.total_value_usd)).filter(Number.isFinite), marked.total_value_usd);
  const benchmark = buildPortfolioBenchmark({
    initial_value_usd: initialValue,
    shadow_value_usd: marked.total_value_usd,
    hodl_value_usd: hodlValue,
    peak_shadow_value_usd: peak
  });

  const saved = await store.savePortfolioMark({
    marked_at: latest.generated_at,
    snapshot_id: latest.id,
    total_value_usd: marked.total_value_usd,
    cash_usd: marked.cash_usd,
    positions: marked.positions,
    prices,
    shadow_return_pct: benchmark.shadow_return_pct,
    hodl_value_usd: benchmark.hodl_value_usd,
    hodl_return_pct: benchmark.hodl_return_pct,
    usd_value_usd: benchmark.usd_value_usd,
    alpha_vs_hodl_pct: benchmark.alpha_vs_hodl_pct,
    drawdown_pct: benchmark.drawdown_pct,
    metadata: {
      cumulative_fees_usd: marked.cumulative_fees_usd,
      alpha_vs_usd_pct: benchmark.alpha_vs_usd_pct,
      benchmark_version: 'hodl_usd_v0.1',
      execution_enabled: false
    }
  });

  console.log(JSON.stringify({
    ok: true,
    saved: Boolean(saved),
    marked_at: latest.generated_at,
    total_value_usd: marked.total_value_usd,
    shadow_return_pct: benchmark.shadow_return_pct,
    hodl_return_pct: benchmark.hodl_return_pct,
    alpha_vs_hodl_pct: benchmark.alpha_vs_hodl_pct,
    drawdown_pct: benchmark.drawdown_pct,
    execution_enabled: false
  }));
} finally {
  await store.close();
}
