#!/usr/bin/env node
// Explicitly invoked offline; never included in hourly Shadow cron.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSyntheticHistory, loadHistoryManifest } from '../src/simulator/history.mjs';
import { selectWalkforwardPolicy, evaluateRetrospectiveTest } from '../src/simulator/walk-forward.mjs';

const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const a = args.find(x => x.startsWith(name + '='));
  return a ? a.slice(name.length + 1) : fallback;
}
const demo = args.includes('--demo');
const manifest = opt('--manifest');
if (Number(demo) + Number(Boolean(manifest)) !== 1) throw new Error('Choose exactly one of --demo or --manifest=manifest.json');
const stage = opt('--stage', 'select');
if (!['select', 'test'].includes(stage)) throw new Error('Invalid stage: select or test');
const root = path.resolve(process.cwd(), opt('--root', 'data/time-machine'));
const data = demo
  ? { datasetId: 'SYNTHETIC_DEMO_ONLY', provenance: {}, intervalMs: 86_400_000, series: buildSyntheticHistory({ days: 2_130, from: Date.UTC(2021, 0, 1) }) }
  : await loadHistoryManifest({ root, manifest });
const outputDir = path.resolve(process.cwd(), 'artifacts/time-machine');
await fs.mkdir(outputDir, { recursive: true });
const lockPath = path.join(outputDir, 'walkforward-policy-lock.json');
const outputPath = path.join(outputDir, 'walkforward-retrospective-2026.json');
if (stage === 'select') {
  const selection = selectWalkforwardPolicy({ series: data.series, stepMs: data.intervalMs });
  selection.datasetId = data.datasetId;
  selection.sourceProvenance = data.provenance;
  selection.syntheticResults = demo;
  await fs.writeFile(lockPath, JSON.stringify(selection, null, 2) + '\n', { mode: 0o600 });
  console.log('WALKFORWARD_LOCKED_SELECTION=' + JSON.stringify({
    ok: true, datasetId: data.datasetId, syntheticResults: demo,
    candidates: selection.candidates.length, validationFolds: selection.folds.length,
    yearsValidated: selection.folds.map(x => x.id),
    lockedPolicy: selection.lockedPolicy, selectionHash: selection.selectionHash,
    bestValidationAlphaPp: selection.leaderboard[0].meanValidationAlphaPp,
    positiveValidationYears: selection.leaderboard[0].foldsBeatingHold,
    output: 'artifacts/time-machine/walkforward-policy-lock.json',
    executionEnabled: false, realOrders: 0, policyPromoted: false
  }));
} else {
  const lockedSelection = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  if (lockedSelection.datasetId !== data.datasetId || lockedSelection.syntheticResults !== demo) {
    throw new Error('walkforward:dataset_manifest_mismatch');
  }
  const result = evaluateRetrospectiveTest({ series: data.series, stepMs: data.intervalMs, lockedSelection });
  result.datasetId = data.datasetId;
  result.syntheticResults = demo;
  result.datasetProvenanceHash = crypto.createHash('sha256').update(JSON.stringify(data.provenance)).digest('hex');
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log('WALKFORWARD_2026_RETROSPECTIVE=' + JSON.stringify({
    ok: true, policy: result.policyId,
    researchGatePassed: result.researchGatePassed,
    testGatePassed: result.testGatePassed,
    days: result.test.days, candidateNetPct: result.test.candidateNetPct,
    holdNetPct: result.test.holdNetPct, alphaVsHoldPp: result.test.alphaVsHoldPp,
    stressedAlphaVsHoldPp: result.stressedTest.alphaVsHoldPp,
    maxDrawdownPct: result.test.candidateMaxDrawdownPct,
    fills: result.test.candidateFills, selectionHash: result.selectionHash,
    output: 'artifacts/time-machine/walkforward-retrospective-2026.json',
    historicalPreviouslyInspected: true,
    executionEnabled: false, realOrders: 0, policyPromoted: false
  }));
}
