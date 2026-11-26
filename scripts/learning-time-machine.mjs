#!/usr/bin/env node
// Never uses Bitso, Render DB or external APIs. Fast replay runs with no sleeps.
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSmaPolicy, runTimeMachine, TIME_MACHINE_DAY_MS } from '../src/simulator/time-machine.mjs';
import { buildSyntheticHistory, loadHistoryManifest } from '../src/simulator/history.mjs';

const args = process.argv.slice(2);
function option(prefix, fallback = null) {
  const hit = args.find(x => x.startsWith(prefix + '='));
  return hit ? hit.slice(prefix.length + 1) : fallback;
}
const demo = args.includes('--demo');
const manifest = option('--manifest');
if ((demo ? 1 : 0) + (manifest ? 1 : 0) !== 1) {
  throw new Error('Provide exactly one of --demo or --manifest=manifest.json (local file within --root)');
}
const start = performance.now();
const root = path.resolve(process.cwd(), option('--root', 'data/time-machine'));
const dataset = demo
  ? { series: buildSyntheticHistory(), intervalMs: TIME_MACHINE_DAY_MS, datasetId: 'SYNTHETIC_DEMO_NOT_HISTORY', provenance: {} }
  : await loadHistoryManifest({ root, manifest });
const fast = Number(option('--fast', '7'));
const slow = Number(option('--slow', '30'));
const feeBps = Number(option('--fee-bps', '10'));
const slippageBps = Number(option('--slippage-bps', '5'));
const result = runTimeMachine({
  series: dataset.series, stepMs: dataset.intervalMs, policy: createSmaPolicy({ fast, slow }),
  feeBps, slippageBps
});
result.syntheticResults = demo;
result.datasetId = dataset.datasetId;
result.provenance = dataset.provenance;
result.runHash = (await import('node:crypto')).default.createHash('sha256').update(JSON.stringify({
  engineHash: result.runHash, datasetId: dataset.datasetId, provenance: dataset.provenance, syntheticResults: demo
})).digest('hex');

const elapsedSeconds = Math.max(0.001, (performance.now() - start) / 1000);
const target = option('--output', 'latest.json');
if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.json$/.test(target)) throw new Error('Invalid output filename');
const outputDir = path.resolve(process.cwd(), 'artifacts/time-machine');
await fs.mkdir(outputDir, { recursive: true });
const outPath = path.join(outputDir, target);
await fs.writeFile(outPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const summary = {
  schema: result.schema,
  datasetId: dataset.datasetId,
  syntheticResults: demo,
  policy: result.policyId,
  bars: result.bars,
  simulatedHistoricalDays: result.bars * result.intervalMs / TIME_MACHINE_DAY_MS,
  elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
  historicalDaysPerSecond: Number((result.bars * result.intervalMs / TIME_MACHINE_DAY_MS / elapsedSeconds).toFixed(2)),
  candidateReturnPct: result.candidate.netReturnPct,
  holdReturnPct: result.benchmarks.hold.netReturnPct,
  alphaVsHoldPp: result.alphaVsHoldPp,
  maxDrawdownPct: result.candidate.maxDrawdownPct,
  fills: result.candidate.fills,
  runHash: result.runHash,
  output: 'artifacts/time-machine/' + target,
  executionEnabled: false,
  realOrders: 0,
  policyTrained: false
};
console.log('TIME_MACHINE_SUMMARY=' + JSON.stringify(summary));
