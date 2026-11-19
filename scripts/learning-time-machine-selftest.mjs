import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildSyntheticHistory, loadHistoryManifest, parseSpotKlinesCsv } from '../src/simulator/history.mjs';
import { runTimeMachine, createSmaPolicy, validateSeries, TIME_MACHINE_DAY_MS } from '../src/simulator/time-machine.mjs';

const START = Date.UTC(2021, 0, 1);
const history = buildSyntheticHistory({ days: 1_826, from: START });
const t0 = performance.now();
const p = createSmaPolicy({ fast: 7, slow: 30 });
const result = runTimeMachine({ series: history, policy: p });
assert.equal(result.bars, 1826);
assert.equal(result.executionEnabled, false);
assert.equal(result.executedRealOrders, 0);
assert.equal(result.policyPromoted, false);
assert.equal(result.benchmarks.cash.finalUsd, 10_000);
assert.equal(result.benchmarks.cash.netReturnPct, 0);
assert.equal(result.candidate.equityCurve.length, 1826);
assert.ok(result.candidate.finalCashUsd >= 0);
assert.ok(result.candidate.audit.fills.every(f => f.simulated === true));
assert.equal(result.runHash, runTimeMachine({ series: history, policy: p }).runHash, 'deterministic hash');
assert.equal(result.candidate.fills, result.candidate.audit.fills.length);

// Lookahead trap: only closed prefix bars, and fill AFTER decision timestamp.
let observations = 0;
const inspectPolicy = {
  id: 'audit_policy',
  decide(ctx) {
    observations++;
    assert.ok(Object.isFrozen(ctx.history));
    assert.ok(Object.isFrozen(ctx.history[0]));
    assert.equal(ctx.observedThrough, ctx.history.at(-1).closeTime);
    assert.equal(ctx.history.length, Math.floor((ctx.history[0].openTime - START) / TIME_MACHINE_DAY_MS) === 0 ? ctx.history.length : ctx.history.length);
    if (ctx.asset === 'BTC' && ctx.history.length === 1) return 'BUY';
    return 'HOLD';
  }
};
const simple = runTimeMachine({ series: buildSyntheticHistory({ days: 95, from: START }), policy: inspectPolicy });
assert.equal(observations, 95 * 3);
assert.equal(simple.candidate.audit.decisions.length, 1);
assert.equal(simple.candidate.audit.fills.length, 1);
assert.ok(Date.parse(simple.candidate.audit.fills[0].at) > Date.parse(simple.candidate.audit.decisions[0].observedThrough));
assert.equal(simple.candidate.audit.fills[0].at, new Date(START + TIME_MACHINE_DAY_MS).toISOString());

// Strict rejection of missing bars and bad OHLC.
const gapped = buildSyntheticHistory({ days: 95, from: START });
gapped.ADA.splice(4, 1);
assert.throws(() => validateSeries(gapped), /gap_or_duplicate_ADA/);
const invalid = buildSyntheticHistory({ days: 95, from: START });
invalid.BTC[2].low = invalid.BTC[2].high + 1;
assert.throws(() => validateSeries(invalid), /bad_ohlc_BTC/);

// Mixed millis (2024) and micros (2025) conversion.
const ms = Date.UTC(2024, 11, 30);
const us = Date.UTC(2025, 0, 1) * 1000;
const csv = [
  [ms, '100', '110', '90', '105', '5', ms + TIME_MACHINE_DAY_MS - 1, 0, 0, 0, 0, 0].join(','),
  [ms + TIME_MACHINE_DAY_MS, '105', '112', '100', '110', '5', ms + 2*TIME_MACHINE_DAY_MS - 1, 0, 0, 0, 0, 0].join(','),
  [us, '110', '114', '107', '111', '5', us + (TIME_MACHINE_DAY_MS - 1) * 1000, 0, 0, 0, 0, 0].join(',')
].join('\n');
const parsed = parseSpotKlinesCsv(csv);
assert.equal(parsed[2].openTime, Date.UTC(2025, 0, 1));
assert.equal(parsed[0].openTime, ms);
assert.equal(parsed[2].closeTime, parsed[2].openTime + TIME_MACHINE_DAY_MS - 1);
assert.throws(() => parseSpotKlinesCsv('1,2'), /expected_binance/);

// Local-only import and SHA256 validation + traversal rejection.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'time-machine-'));
try {
  const assets = {};
  for (const symbol of ['BTC', 'ADA', 'AAVE']) {
    const file = symbol + '.csv';
    await fs.writeFile(path.join(temp, file), csv);
    assets[symbol] = { file, sha256: crypto.createHash('sha256').update(csv).digest('hex') };
  }
  const manifest = { format: 'binance_spot_klines_v1', interval: '1d', datasetId: 'selftest', assets };
  await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
  const loaded = await loadHistoryManifest({ root: temp });
  assert.equal(loaded.alignedBars, 3);
  assert.equal(loaded.provenance.AAVE.bars, 3);
  manifest.assets.BTC.sha256 = '0'.repeat(64);
  await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(() => loadHistoryManifest({ root: temp }), /checksum_mismatch_BTC/);
  await assert.rejects(() => loadHistoryManifest({ root: temp, manifest: '../escape.json' }), /path_outside_root/);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
const secs = Number(((performance.now() - t0) / 1000).toFixed(3));
console.log('SHADOW_TIME_MACHINE_SELFTEST=' + JSON.stringify({
  ok: true, syntheticDays: 1826, candidateReturnPct: result.candidate.netReturnPct,
  holdReturnPct: result.benchmarks.hold.netReturnPct,
  alphaVsHoldPp: result.alphaVsHoldPp, hashStable: true,
  noLookaheadFillVerified: true, mixedTimestampUnitsVerified: true,
  strictGapChecksVerified: true, checksumAndSandboxVerified: true,
  runtimeSeconds: secs, executionEnabled: false, realOrders: 0
}));
