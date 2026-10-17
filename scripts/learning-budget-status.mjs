import { monthWindowUtc, evaluateMonthlyReasoningBudget } from '../src/learning/runtime-telemetry.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
try {
  const window = monthWindowUtc(new Date());
  const runs = await store.reasoningRunsBetween(window.start, window.end, 50000);
  const rates = {
    input_usd_per_million_tokens: process.env.LEARNING_COST_INPUT_USD_PER_MILLION,
    output_usd_per_million_tokens: process.env.LEARNING_COST_OUTPUT_USD_PER_MILLION,
    web_search_usd_per_call: process.env.LEARNING_COST_WEB_SEARCH_USD_PER_CALL
  };
  const budget = evaluateMonthlyReasoningBudget({
    runs,
    monthly_ai_budget_usd: process.env.LEARNING_MONTHLY_AI_BUDGET_USD,
    monthly_reasoning_run_limit: process.env.LEARNING_MONTHLY_REASONING_RUN_LIMIT || 100,
    request_ceiling_usd: 0,
    alert_pct: process.env.LEARNING_BUDGET_ALERT_PCT || 80,
    rates
  });
  const total = Number(process.env.LEARNING_MONTHLY_TOTAL_BUDGET_USD);
  const infra = Number(process.env.LEARNING_MONTHLY_INFRA_BUDGET_USD);
  const ai = Number(process.env.LEARNING_MONTHLY_AI_BUDGET_USD);

  console.log(JSON.stringify({
    month: window,
    ai_budget: budget,
    planned_total_budget_usd: Number.isFinite(total) ? total : null,
    planned_infra_budget_usd: Number.isFinite(infra) ? infra : null,
    planned_ai_budget_usd: Number.isFinite(ai) ? ai : null,
    planned_unallocated_usd: [total, infra, ai].every(Number.isFinite) ? Number((total - infra - ai).toFixed(2)) : null,
    note: 'application guard controls estimated variable AI spend; fixed hosting charges are controlled by selected infrastructure plans',
    execution_enabled: false
  }, null, 2));
} finally {
  await store.close();
}
