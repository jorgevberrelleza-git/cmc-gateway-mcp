import { summarizeReasoningCost } from '../src/learning/runtime-telemetry.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
try {
  const runs = await store.listReasoningRuns({ limit: Number(process.env.LEARNING_COST_RUN_LIMIT || 1000) });
  const report = summarizeReasoningCost(runs, {
    input_usd_per_million_tokens: process.env.LEARNING_COST_INPUT_USD_PER_MILLION,
    output_usd_per_million_tokens: process.env.LEARNING_COST_OUTPUT_USD_PER_MILLION,
    web_search_usd_per_call: process.env.LEARNING_COST_WEB_SEARCH_USD_PER_CALL
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
