function finite(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePositions(positions = {}) {
  return Object.fromEntries(Object.entries(positions)
    .map(([symbol, quantity]) => [String(symbol).toUpperCase(), finite(quantity, 0)])
    .filter(([, quantity]) => Math.abs(quantity) > 1e-15));
}

export function createSeedLedgerEvents({ occurred_at, cash_usd = 0, positions = {}, prices = {} } = {}) {
  if (!occurred_at || !Number.isFinite(Date.parse(occurred_at))) throw new Error('occurred_at_required');
  const events = [];
  const normalized = normalizePositions(positions);

  if (finite(cash_usd, 0) !== 0) {
    events.push({
      event_key: `seed:USD:${occurred_at}`,
      occurred_at,
      event_type: 'seed',
      symbol: 'USD',
      quantity_delta: 0,
      cash_delta_usd: finite(cash_usd, 0),
      reference_price_usd: 1,
      fee_usd: 0,
      metadata: { seed_component: 'cash' }
    });
  }

  for (const [symbol, quantity] of Object.entries(normalized)) {
    const price = Number.isFinite(Number(prices?.[symbol])) ? Number(prices[symbol]) : null;
    events.push({
      event_key: `seed:${symbol}:${occurred_at}`,
      occurred_at,
      event_type: 'seed',
      symbol,
      quantity_delta: quantity,
      cash_delta_usd: 0,
      reference_price_usd: price,
      fee_usd: 0,
      metadata: { seed_component: 'position' }
    });
  }

  return events;
}

export function paperOrderToLedgerEvent(order, { occurred_at, event_key } = {}) {
  const side = String(order?.side || '').toLowerCase();
  const quantity = finite(order?.quantity, NaN);
  const referencePrice = finite(order?.reference_price_usd, NaN);
  const fee = Math.max(0, finite(order?.estimated_fee_usd, 0));
  const slippageBps = Math.max(0, finite(order?.estimated_slippage_bps, 0));
  if (!['buy', 'sell'].includes(side)) throw new Error('paper_order_side_must_be_buy_or_sell');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('paper_order_quantity_required');
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) throw new Error('paper_order_reference_price_required');
  if (!occurred_at || !Number.isFinite(Date.parse(occurred_at))) throw new Error('occurred_at_required');

  const slip = slippageBps / 10_000;
  const effectivePrice = side === 'buy'
    ? referencePrice * (1 + slip)
    : referencePrice * (1 - slip);
  const gross = quantity * effectivePrice;

  return {
    event_key: event_key || `paper:${order.id || 'na'}:${side}:${occurred_at}`,
    occurred_at,
    event_type: side === 'buy' ? 'paper_buy' : 'paper_sell',
    decision_id: order.decision_id ?? null,
    paper_order_id: order.id ?? null,
    symbol: String(order.symbol || '').toUpperCase(),
    quantity_delta: side === 'buy' ? quantity : -quantity,
    cash_delta_usd: side === 'buy' ? -(gross + fee) : (gross - fee),
    reference_price_usd: effectivePrice,
    fee_usd: fee,
    metadata: {
      original_reference_price_usd: referencePrice,
      estimated_slippage_bps: slippageBps,
      execution_mode: 'paper_only'
    }
  };
}

export function replayLedger(events = []) {
  const state = { cash_usd: 0, positions: {}, fees_usd: 0 };
  const sorted = [...events].sort((a, b) => {
    const dt = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
    return dt || finite(a.id, 0) - finite(b.id, 0);
  });

  for (const event of sorted) {
    state.cash_usd += finite(event.cash_delta_usd, 0);
    state.fees_usd += Math.max(0, finite(event.fee_usd, 0));
    const symbol = String(event.symbol || '').toUpperCase();
    if (symbol && symbol !== 'USD') {
      state.positions[symbol] = finite(state.positions[symbol], 0) + finite(event.quantity_delta, 0);
      if (Math.abs(state.positions[symbol]) < 1e-15) delete state.positions[symbol];
      if (state.positions[symbol] < -1e-12) throw new Error(`negative_shadow_position:${symbol}`);
    }
  }
  return state;
}

export function markLedgerState(state, prices = {}) {
  const positions = {};
  let positionsValue = 0;
  for (const [symbol, quantity] of Object.entries(state?.positions || {})) {
    const price = Number(prices?.[symbol]);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`missing_mark_price:${symbol}`);
    const value = Number(quantity) * price;
    positions[symbol] = { quantity: Number(quantity), price_usd: price, value_usd: value };
    positionsValue += value;
  }
  const cash = finite(state?.cash_usd, 0);
  return {
    cash_usd: cash,
    positions,
    positions_value_usd: positionsValue,
    total_value_usd: cash + positionsValue,
    cumulative_fees_usd: finite(state?.fees_usd, 0)
  };
}
