// Shadow Time Machine v0.2: offline model selection with chronological walk-forward.
// No production imports, external network, secrets, AI, orders, or policy promotion.
// Research selection locks on data ending 2025-12-31. The 2026 period is
// withheld from selection and only assessed by evaluateRetrospectiveTest().
import crypto from 'node:crypto';
import { createSmaPolicy, runTimeMachine, validateSeries, TIME_MACHINE_ASSETS, TIME_MACHINE_DAY_MS } from './time-machine.mjs';

const SHA = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const at = iso => Date.parse(iso + 'T00:00:00.000Z');
const fixed = x => Number(x.toFixed(5));
const average = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const fail = msg => { throw new Error('walkforward:' + msg); };
const assert = (condition, msg) => { if (!condition) fail(msg); };

export const WF_CANDIDATES = Object.freeze([
  Object.freeze({ fast: 5, slow: 20 }),
  Object.freeze({ fast: 7, slow: 30 }),
  Object.freeze({ fast: 10, slow: 50 }),
  Object.freeze({ fast: 14, slow: 60 }),
  Object.freeze({ fast: 20, slow: 50 }),
  Object.freeze({ fast: 20, slow: 90 }),
  Object.freeze({ fast: 30, slow: 120 }),
  Object.freeze({ fast: 40, slow: 200 })
]);

// Expanding anchored training sets; independent 2023, 2024, 2025 validation.
// 7-day purge prevents decisions close to the boundary from overlapping future
// 24h/72h labels; each fold starts a fresh paper portfolio and requires its
// own warm-up from its validation period (conservative, no cross-period fills).
export const WF_FOLDS = Object.freeze([
  Object.freeze({ id: '2023', trainStart: '2021-01-01', trainEnd: '2023-01-01', validStart: '2023-01-08', validEnd: '2024-01-01' }),
  Object.freeze({ id: '2024', trainStart: '2021-01-01', trainEnd: '2024-01-01', validStart: '2024-01-08', validEnd: '2025-01-01' }),
  Object.freeze({ id: '2025', trainStart: '2021-01-01', trainEnd: '2025-01-01', validStart: '2025-01-08', validEnd: '2026-01-01' })
]);
export const WF_TEST_WINDOW = Object.freeze({ from: '2026-01-08', to: '2026-11-01' });
export const WF_ASSUMPTIONS = Object.freeze({
  initialCashUsd: 10000,
  feeBps: 10,
  slippageBps: 5,
  maxAssetWeight: 0.4,
  maxTotalExposure: 0.8,
  orderFraction: 0.4
});
export const WF_STRESS_ASSUMPTIONS = Object.freeze({ feeBps: 30, slippageBps: 20 });

function validateOptions(options) {
  assert(options && typeof options === 'object', 'options_required');
  const { initialCashUsd, feeBps, slippageBps, maxAssetWeight, maxTotalExposure, orderFraction } = options;
  assert(Number.isFinite(initialCashUsd) && initialCashUsd > 0, 'invalid_capital');
  assert(Number.isFinite(feeBps) && feeBps >= 0 && feeBps <= 1000, 'invalid_fee');
  assert(Number.isFinite(slippageBps) && slippageBps >= 0 && slippageBps <= 1000, 'invalid_slippage');
  assert(Number.isFinite(maxAssetWeight) && maxAssetWeight > 0 && maxAssetWeight <= 1, 'invalid_asset_cap');
  assert(Number.isFinite(maxTotalExposure) && maxTotalExposure > 0 && maxTotalExposure <= 1, 'invalid_total_cap');
  assert(Number.isFinite(orderFraction) && orderFraction > 0 && orderFraction <= 1, 'invalid_fraction');
}
function validatedHistory(series, stepMs) {
  assert(stepMs === TIME_MACHINE_DAY_MS, 'only_daily_replay_supported');
  return validateSeries(series, { stepMs });
}
function subseries(full, start, end) {
  const from = at(start), to = at(end);
  assert(Number.isFinite(from) && Number.isFinite(to) && to > from, 'invalid_range');
  const ids = [];
  for (let i = 0; i < full.times.length; i++) {
    if (full.times[i] >= from && full.times[i] < to) ids.push(i);
  }
  assert(ids.length >= 60, 'not_enough_bars_' + start + '_' + end);
  const output = {};
  for (const asset of TIME_MACHINE_ASSETS) {
    output[asset] = ids.map(i => full.alignedBars[asset][i]);
  }
  return output;
}
function pretestHash(full) {
  const limit = at('2026-01-01');
  const bars = {};
  for (const asset of TIME_MACHINE_ASSETS) {
    bars[asset] = full.alignedBars[asset].filter(b => b.openTime < limit);
  }
  assert(bars.BTC.length >= 1400, 'insufficient_training_history');
  return SHA({ assets: [...TIME_MACHINE_ASSETS], intervalMs: TIME_MACHINE_DAY_MS, bars });
}
function compact(report) {
  return {
    days: report.bars,
    candidateNetPct: report.candidate.netReturnPct,
    holdNetPct: report.benchmarks.hold.netReturnPct,
    alphaVsHoldPp: report.alphaVsHoldPp,
    candidateMaxDrawdownPct: report.candidate.maxDrawdownPct,
    holdMaxDrawdownPct: report.benchmarks.hold.maxDrawdownPct,
    drawdownReliefPp: fixed(report.candidate.maxDrawdownPct - report.benchmarks.hold.maxDrawdownPct),
    candidateFills: report.candidate.fills,
    candidateDecisions: report.candidate.decisions,
    paidFeesUsd: report.candidate.paidFeesUsd
  };
}
function evaluatePeriod(windowSeries, candidate, assumptions) {
  return compact(runTimeMachine({ series: windowSeries, policy: createSmaPolicy(candidate), ...assumptions }));
}
function sortCandidates(a, b) {
  // Robustness > headline returns: more positive independent validation years,
  // then stronger mean alpha, then drawdown relief, then fewer fills.
  return b.foldsBeatingHold - a.foldsBeatingHold ||
    b.meanValidationAlphaPp - a.meanValidationAlphaPp ||
    b.meanDrawdownReliefPp - a.meanDrawdownReliefPp ||
    a.meanFills - b.meanFills ||
    a.policyId.localeCompare(b.policyId);
}
function selectionCore(selection) {
  return {
    schema: selection.schema,
    phase: selection.phase,
    sourcePretestHash: selection.sourcePretestHash,
    candidates: selection.candidates,
    folds: selection.folds,
    assumptions: selection.assumptions,
    stressAssumptions: selection.stressAssumptions,
    leaderboard: selection.leaderboard,
    lockedPolicy: selection.lockedPolicy,
    independentTestStart: selection.independentTestStart,
    independentlyBlind: selection.independentlyBlind,
    embargoDays: selection.embargoDays
  };
}

export function selectWalkforwardPolicy({
  series,
  stepMs = TIME_MACHINE_DAY_MS,
  candidates = WF_CANDIDATES,
  assumptions = WF_ASSUMPTIONS
} = {}) {
  validateOptions(assumptions);
  assert(Array.isArray(candidates) && candidates.length >= 2 && candidates.length <= 24, 'invalid_candidate_count');
  const policyIds = new Set();
  for (const c of candidates) {
    const policy = createSmaPolicy(c);
    assert(!policyIds.has(policy.id), 'duplicate_candidate');
    policyIds.add(policy.id);
  }
  const full = validatedHistory(series, stepMs);
  const foldData = WF_FOLDS.map(f => ({
    ...f,
    trainSeries: subseries(full, f.trainStart, f.trainEnd),
    validSeries: subseries(full, f.validStart, f.validEnd)
  }));
  const board = [];
  for (const c of candidates) {
    const policy = createSmaPolicy(c);
    const folds = [];
    for (const fold of foldData) {
      const train = evaluatePeriod(fold.trainSeries, c, assumptions);
      const validation = evaluatePeriod(fold.validSeries, c, assumptions);
      const stressed = evaluatePeriod(fold.validSeries, c, { ...assumptions, ...WF_STRESS_ASSUMPTIONS });
      folds.push({
        id: fold.id,
        train, validation,
        stressedValidation: stressed,
        trainThrough: fold.trainEnd,
        validationFrom: fold.validStart,
        validationThrough: fold.validEnd
      });
    }
    const valid = folds.map(x => x.validation);
    const stressed = folds.map(x => x.stressedValidation);
    const foldsBeatingHold = valid.filter(x => x.alphaVsHoldPp > 0).length;
    board.push({
      policyId: policy.id,
      settings: { fast: c.fast, slow: c.slow },
      folds,
      foldsBeatingHold,
      meanValidationAlphaPp: fixed(average(valid.map(x => x.alphaVsHoldPp))),
      worstValidationAlphaPp: fixed(Math.min(...valid.map(x => x.alphaVsHoldPp))),
      meanDrawdownReliefPp: fixed(average(valid.map(x => x.drawdownReliefPp))),
      meanStressedAlphaPp: fixed(average(stressed.map(x => x.alphaVsHoldPp))),
      worstCandidateDrawdownPct: fixed(Math.min(...valid.map(x => x.candidateMaxDrawdownPct))),
      meanFills: fixed(average(valid.map(x => x.candidateFills)))
    });
  }
  board.sort(sortCandidates);
  const best = board[0];
  // A data-driven policy is only a candidate. These criteria can reject
  // model selection as a failure; NEVER authorize live execution.
  const meetsResearchGate = best.foldsBeatingHold >= 2 &&
    best.meanValidationAlphaPp > 0 &&
    best.meanStressedAlphaPp >= 0 &&
    best.worstCandidateDrawdownPct >= -40;
  const result = {
    schema: 'shadow_time_machine_walkforward_v0.2',
    phase: 'LOCKED_SELECTION_PRETEST',
    sourcePretestHash: pretestHash(full),
    candidates: candidates.map(x => ({ fast: x.fast, slow: x.slow })),
    folds: WF_FOLDS.map(x => ({ ...x })),
    assumptions: { ...assumptions },
    stressAssumptions: { ...WF_STRESS_ASSUMPTIONS },
    leaderboard: board,
    lockedPolicy: {
      policyId: best.policyId,
      settings: { ...best.settings },
      meetsResearchGate,
      eligibleForRealMoney: false,
      policyPromoted: false,
      approvalReason: meetsResearchGate
        ? 'RESEARCH_ONLY_NEEDS_PROSPECTIVE_ATTESTED_VALIDATION'
        : 'VALIDATION_GATE_FAILED'
    },
    independentTestStart: WF_TEST_WINDOW.from,
    independentlyBlind: false,
    embargoDays: 7,
    noExternalCalls: true,
    executionEnabled: false,
    realOrders: 0,
    notice: '2026 previously inspected in MVP; retrospective test is NOT a pristine unseen holdout.'
  };
  result.selectionHash = SHA(selectionCore(result));
  return result;
}

export function evaluateRetrospectiveTest({
  series, stepMs = TIME_MACHINE_DAY_MS, lockedSelection
} = {}) {
  assert(lockedSelection && typeof lockedSelection === 'object', 'selection_required');
  assert(lockedSelection.schema === 'shadow_time_machine_walkforward_v0.2', 'invalid_selection_schema');
  assert(lockedSelection.phase === 'LOCKED_SELECTION_PRETEST', 'not_locked_selection');
  assert(lockedSelection.selectionHash === SHA(selectionCore(lockedSelection)), 'tampered_selection');
  assert(lockedSelection.embargoDays === 7, 'embargo_mismatch');
  assert(lockedSelection.executionEnabled === false && lockedSelection.realOrders === 0, 'execution_forbidden');
  assert(lockedSelection.lockedPolicy?.eligibleForRealMoney === false, 'execution_forbidden');
  assert(lockedSelection.lockedPolicy?.policyPromoted === false, 'promotion_forbidden');
  assert(lockedSelection.independentTestStart === WF_TEST_WINDOW.from, 'modified_test_window');
  validateOptions(lockedSelection.assumptions);
  const full = validatedHistory(series, stepMs);
  assert(pretestHash(full) === lockedSelection.sourcePretestHash, 'dataset_drift_before_test');
  const candidate = lockedSelection.lockedPolicy.settings;
  assert(createSmaPolicy(candidate).id === lockedSelection.lockedPolicy.policyId, 'policy_id_mismatch');
  const testSeries = subseries(full, WF_TEST_WINDOW.from, WF_TEST_WINDOW.to);
  const standard = evaluatePeriod(testSeries, candidate, lockedSelection.assumptions);
  const stressed = evaluatePeriod(testSeries, candidate, {
    ...lockedSelection.assumptions,
    ...lockedSelection.stressAssumptions
  });
  const outcome = {
    schema: 'shadow_time_machine_retrospective_2026_v0.2',
    phase: 'RESEARCH_ONLY_RETROSPECTIVE_TEST',
    sourcePretestHash: lockedSelection.sourcePretestHash,
    selectionHash: lockedSelection.selectionHash,
    policyId: lockedSelection.lockedPolicy.policyId,
    researchGatePassed: lockedSelection.lockedPolicy.meetsResearchGate,
    testedFrom: WF_TEST_WINDOW.from,
    testedThrough: WF_TEST_WINDOW.to,
    test: standard,
    stressedTest: stressed,
    testGatePassed: standard.alphaVsHoldPp > 0 &&
      stressed.alphaVsHoldPp > 0 &&
      standard.candidateMaxDrawdownPct >= -40,
    historicalEvaluationPreviouslySeen: true,
    fullyIndependentProspectiveEvidence: false,
    policyPromoted: false,
    executionEnabled: false,
    realOrders: 0,
    warning: '2026 market outcomes were previously inspected. Do not claim unseen alpha or go-live readiness.'
  };
  outcome.testHash = SHA(outcome);
  return outcome;
}
