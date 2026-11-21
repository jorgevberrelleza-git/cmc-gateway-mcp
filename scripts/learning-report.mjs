import { buildLearningReport } from '../src/learning/report.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const hours = Math.max(1, Number(process.env.LEARNING_REPORT_HOURS || 24));
const to = new Date();
const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
const store = createLearningStore();

try {
  const [snapshots, decisions, outcomes, watchdogEvents, queue, marks] = await Promise.all([
    store.snapshotsBetween(from.toISOString(), to.toISOString(), 5000),
    store.listDecisions({ from: from.toISOString(), to: to.toISOString(), limit: 5000 }),
    store.listOutcomes({ from: from.toISOString(), to: to.toISOString(), limit: 10000 }),
    store.listWatchdogEvents({ from: from.toISOString(), to: to.toISOString(), limit: 5000 }),
    store.listDecisionQueue({ limit: 5000 }),
    store.recentPortfolioMarks(5000)
  ]);

  const queueInWindow = queue.filter(x => {
    const t = Date.parse(x.created_at);
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });
  const marksInWindow = marks.filter(x => {
    const t = Date.parse(x.marked_at);
    return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
  });

  const report = buildLearningReport({
    from: from.toISOString(),
    to: to.toISOString(),
    snapshots,
    queue: queueInWindow,
    decisions,
    outcomes,
    portfolioMarks: marksInWindow,
    watchdogEvents
  });

  console.log(JSON.stringify(report, null, 2));
} finally {
  await store.close();
}
