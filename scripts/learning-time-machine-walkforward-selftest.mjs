import assert from 'node:assert/strict';
import { buildSyntheticHistory } from '../src/simulator/history.mjs';
import {
  WF_CANDIDATES, WF_FOLDS, WF_TEST_WINDOW,
  selectWalkforwardPolicy, evaluateRetrospectiveTest
} from '../src/simulator/walk-forward.mjs';

const base = buildSyntheticHistory({ days: 2_130, from: Date.UTC(2021, 0, 1) });
const selection = selectWalkforwardPolicy({ series: base });
assert.equal(selection.phase, 'LOCKED_SELECTION_PRETEST');
assert.equal(selection.leaderboard.length, WF_CANDIDATES.length);
assert.equal(selection.folds.length, WF_FOLDS.length);
assert.equal(selection.independentTestStart, WF_TEST_WINDOW.from);
assert.equal(selection.executionEnabled, false);
assert.equal(selection.lockedPolicy.eligibleForRealMoney, false);
assert.equal(selection.lockedPolicy.policyPromoted, false);
assert.equal(selection.independentlyBlind, false);
assert.ok(selection.leaderboard.every(x => x.folds.length === 3));
assert.ok(selection.leaderboard.every(x => x.folds.every(f => f.validation.days > 60 && f.train.days > 300)));
assert.ok(selection.folds.every(x => Date.parse(x.validStart) > Date.parse(x.trainEnd)));
assert.ok(selection.folds.every(x => Date.parse(x.validEnd) <= Date.parse('2026-01-01')));
assert.equal(selection.selectionHash, selectWalkforwardPolicy({ series: base }).selectionHash);

// Very important: changing ALL 2026 prices must not change the selected
// policy, validation leaderboard, or locked selection hash.
const alteredTest = structuredClone(base);
const last = Date.UTC(2026, 0, 1);
for (const asset of ['BTC', 'ADA', 'AAVE']) {
  for (const bar of alteredTest[asset]) {
    if (bar.openTime >= last) {
      const daysInto2026 = (bar.openTime - last) / 86_400_000;
      // Change the SHAPE, not just the scale, of future-only history.
      const factor = 0.45 + daysInto2026 * 0.004;
      bar.open *= factor;
      bar.high *= factor;
      bar.low *= factor;
      bar.close *= factor;
    }
  }
}
const secondSelection = selectWalkforwardPolicy({ series: alteredTest });
assert.equal(secondSelection.selectionHash, selection.selectionHash);
assert.deepEqual(secondSelection.lockedPolicy, selection.lockedPolicy);
assert.deepEqual(secondSelection.leaderboard, selection.leaderboard);

const retrospective = evaluateRetrospectiveTest({ series: base, lockedSelection: selection });
assert.equal(retrospective.policyId, selection.lockedPolicy.policyId);
assert.equal(retrospective.executionEnabled, false);
assert.equal(retrospective.realOrders, 0);
assert.equal(retrospective.policyPromoted, false);
assert.equal(retrospective.historicalEvaluationPreviouslySeen, true);
assert.equal(retrospective.fullyIndependentProspectiveEvidence, false);
assert.ok(retrospective.test.days >= 200);
assert.ok(Number.isFinite(retrospective.test.candidateNetPct));
const alteredResult = evaluateRetrospectiveTest({ series: alteredTest, lockedSelection: selection });
assert.notEqual(alteredResult.testHash, retrospective.testHash);
assert.equal(alteredResult.selectionHash, retrospective.selectionHash);

// No fake lock editing or train-set changes allowed.
const tampered = structuredClone(selection);
tampered.lockedPolicy.settings.fast = 3;
assert.throws(
  () => evaluateRetrospectiveTest({ series: base, lockedSelection: tampered }),
  /tampered_selection/
);
const shiftedPast = structuredClone(base);
shiftedPast.BTC[5].open *= 1.01;
shiftedPast.BTC[5].high *= 1.01;
shiftedPast.BTC[5].low *= 1.01;
shiftedPast.BTC[5].close *= 1.01;
assert.throws(
  () => evaluateRetrospectiveTest({ series: shiftedPast, lockedSelection: selection }),
  /dataset_drift_before_test/
);
assert.throws(() => selectWalkforwardPolicy({ series: base, candidates: [{ fast: 7, slow: 30 }, { fast: 7, slow: 30 }] }), /duplicate_candidate/);

console.log('SHADOW_WALKFORWARD_V02_SELFTEST=' + JSON.stringify({
  ok: true,
  candidates: selection.leaderboard.length,
  folds: selection.folds.length,
  winner: selection.lockedPolicy.policyId,
  lockHashStable: true,
  testDataCannotInfluenceSelection: true,
  testCorruptionDetected: true,
  lockTamperingRejected: true,
  productionExecutionEnabled: false,
  policyPromoted: false
}));
