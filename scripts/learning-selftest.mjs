import assert from 'node:assert/strict';
import { detectMaterialEvent } from '../src/learning/event-detector.mjs';

function snapshot({ btc = 80000, trap = 20, spot = 50, wall = 0, gate = 'NORMAL_REVIEW', generatedAt = '2026-10-13T00:00:00Z' } = {}) {
  return {
    snapshot_version: '0.6.2',
    generated_at: generatedAt,
    assets: ['BTC'],
    quotes: { content: [{ type: 'text', text: JSON.stringify({ headers: ['symbol','price'], rows: [['BTC', btc]] }) }] },
    microstructure: { assets: { BTC: { scores: {
      trap_risk_0_100: trap,
      spot_confirmation_0_100: spot,
      persistent_wall_pressure_minus100_to100: wall,
      microstructure_confidence_0_100: 90
    }, execution_context_gate: gate } } },
    defi_fundamentals: { assets: {} }
  };
}

const quiet = detectMaterialEvent(snapshot(), snapshot({ btc: 80800, generatedAt: '2026-10-13T01:00:00Z' }));
assert.equal(quiet.material, false, '1% BTC move should remain an observation under default threshold');

const move = detectMaterialEvent(snapshot(), snapshot({ btc: 82400, generatedAt: '2026-10-13T01:00:00Z' }));
assert.equal(move.material, true, '3% BTC move should trigger a material event');
assert.ok(move.reasons.some(r => r.startsWith('BTC:price_move_')));

const micro = detectMaterialEvent(snapshot(), snapshot({ spot: 78, wall: 55, generatedAt: '2026-10-13T01:00:00Z' }));
assert.equal(micro.material, true, 'microstructure regime change should trigger an event');
assert.ok(micro.reasons.some(r => r.includes('spot_delta')));
assert.ok(micro.reasons.some(r => r.includes('wall_delta')));

const gate = detectMaterialEvent(snapshot(), snapshot({ gate: 'BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA', generatedAt: '2026-10-13T01:00:00Z' }));
assert.equal(gate.material, true, 'execution gate change should trigger an event');

console.log('learning-selftest: ok');
