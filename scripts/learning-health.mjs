import { buildRuntimeHealth } from '../src/learning/runtime-telemetry.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
try {
  const [latestSnapshot, marks, queue, reasoningRuns, cycles] = await Promise.all([
    store.latestSnapshot(),
    store.recentPortfolioMarks(1),
    store.listDecisionQueue({ limit: 1000 }),
    store.listReasoningRuns({ limit: 500 }),
    store.recentRuntimeCycles(20)
  ]);
  const health = buildRuntimeHealth({
    latestSnapshot,
    latestPortfolioMark: marks[0] || null,
    queue,
    reasoningRuns,
    runtimeCycles: cycles
  });
  console.log(JSON.stringify(health, null, 2));
  if (!health.healthy) process.exitCode = 2;
} finally {
  await store.close();
}
