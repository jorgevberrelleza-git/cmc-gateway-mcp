import { extractUsdPrices } from '../src/learning/features.mjs';
import { fillMissingUsdPrices } from '../src/learning/valuation-fallback.mjs';
import { createSeedLedgerEvents } from '../src/learning/portfolio-ledger.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();

try {
  const existing = await store.ledgerEvents();
  if (existing.length) {
    console.log(JSON.stringify({ ok: true, seeded: false, reason: 'ledger_already_initialized', execution_enabled: false }));
  } else {
    const raw = process.env.LEARNING_INITIAL_PORTFOLIO_JSON;
    if (!raw) throw new Error('LEARNING_INITIAL_PORTFOLIO_JSON is required only until the shadow ledger is initialized');

    const seed = JSON.parse(raw);
    const latest = await store.latestSnapshot();
    if (!latest) throw new Error('at least one stored snapshot is required before portfolio seed');
    const extractedPrices = extractUsdPrices(latest.payload || {});
    const resolved = await fillMissingUsdPrices(extractedPrices, Object.keys(seed.positions || {}));
    const prices = resolved.prices;
    const positions = Object.fromEntries(Object.entries(seed.positions || {})
      .map(([symbol, quantity]) => [String(symbol).toUpperCase(), Number(quantity)]));

    for (const [symbol, quantity] of Object.entries(positions)) {
      if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`invalid_seed_quantity:${symbol}`);
      if (quantity > 0 && !Number.isFinite(Number(prices[symbol]))) throw new Error(`missing_seed_price:${symbol}`);
    }

    const occurredAt = seed.occurred_at || latest.generated_at;
    const events = createSeedLedgerEvents({
      occurred_at: occurredAt,
      cash_usd: Number(seed.cash_usd) || 0,
      positions,
      prices
    });

    let inserted = 0;
    for (const event of events) {
      if (await store.appendLedgerEvent(event)) inserted += 1;
    }

    console.log(JSON.stringify({
      ok: true,
      seeded: true,
      inserted_events: inserted,
      occurred_at: occurredAt,
      symbols: Object.keys(positions),
      execution_enabled: false
    }));
  }
} finally {
  await store.close();
}
