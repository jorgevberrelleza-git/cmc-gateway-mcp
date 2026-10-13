import { paperOrderToLedgerEvent, replayLedger } from '../src/learning/portfolio-ledger.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();

try {
  const ledger = await store.ledgerEvents();
  if (!ledger.length) throw new Error('portfolio ledger is empty; seed the shadow portfolio first');

  const orders = await store.unledgeredPaperOrders(Number(process.env.LEARNING_PAPER_FILL_LIMIT || 200));
  const summary = { proposed: orders.length, filled: 0, rejected: 0, errors: [] };
  const workingEvents = [...ledger];

  for (const order of orders) {
    try {
      const state = replayLedger(workingEvents);
      const event = paperOrderToLedgerEvent(order, {
        occurred_at: order.created_at,
        event_key: `paper-order:${order.id}`
      });

      const symbol = String(order.symbol || '').toUpperCase();
      const side = String(order.side || '').toLowerCase();

      if (side === 'buy' && state.cash_usd + Number(event.cash_delta_usd) < -1e-8) {
        await store.setPaperOrderState(order.id, 'rejected_insufficient_shadow_cash');
        summary.rejected += 1;
        continue;
      }

      if (side === 'sell') {
        const available = Number(state.positions?.[symbol] || 0);
        if (available + Number(event.quantity_delta) < -1e-12) {
          await store.setPaperOrderState(order.id, 'rejected_insufficient_shadow_position');
          summary.rejected += 1;
          continue;
        }
      }

      const saved = await store.appendLedgerEvent(event);
      if (saved) {
        workingEvents.push(saved);
        await store.setPaperOrderState(order.id, 'simulated_filled');
        summary.filled += 1;
      }
    } catch (error) {
      summary.errors.push({ paper_order_id: order.id, error: error?.message || String(error) });
      await store.setPaperOrderState(order.id, 'paper_fill_error');
    }
  }

  console.log(JSON.stringify({ ok: summary.errors.length === 0, ...summary, execution_enabled: false }));
} finally {
  await store.close();
}
