import assert from 'node:assert/strict';
import { evaluateDataConsistency } from '../src/learning/data-consistency.mjs';
import { buildRegimeEvidence } from '../src/learning/regime-evidence.mjs';
import { evaluateShadowV2 } from '../src/learning/shadow-v2.mjs';
import { extractUsdPrices } from '../src/learning/features.mjs';

function block(value) {
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] };
}

const at = '2026-10-14T12:00:00Z';
const snapshot = {
  snapshot_version: '0.6.2',
  generated_at: at,
  assets: ['BTC','AAVE','ADA'],
  cmc_ids: { BTC: '1', AAVE: '7278', ADA: '2010' },
  market: {
    generated_at: at,
    global: block({
      market_size: { total_crypto_market_cap_usd: { percent_change: { '24h': '+1.5%' } } },
      liquidity: { volume24h: { total: { percent_change: { '24h': '+5%' } }, spot: { percent_change: { '24h': '+25%' } } } },
      sentiment: { fear_greed: { current: { index: 55 } } },
      rotation: { dominance: { btc: { current: '+59.8%', history: { yesterday: '+59.5%' } } } },
      leverage: { open_interest: { total: { percent_change: { '24h': '+5%' } } } }
    }),
    technicals: block({ rsi: { rsi14: '58' } }),
    derivatives: block({
      totalOpenInterest: { percentage_change_24h: '+15%' },
      fundingRate: { current: '0.002', percentage_change_24h: '+120%' }
    }),
    events: block({
      upcomingEventNews: {
        headers: ['title','eventDate'],
        rows: [['Scheduled macro release','14 October 2026']]
      }
    })
  },
  quotes: block({
    headers: ['id','symbol','price','percent_change_1h','percent_change_24h','percent_change_7d','percent_change_30d'],
    rows: [
      ['1','BTC',83000,0.1,1.5,-2,8],
      ['7278','AAVE',160,-0.2,3,-8,29],
      ['2010','ADA',0.24,-0.4,2,-10,16]
    ]
  }),
  microstructure: {
    assets: {
      BTC: {
        available: true,
        scores: {
          trap_risk_0_100: 25,
          crowding_risk_0_100: 30,
          spot_confirmation_0_100: 24,
          persistent_wall_pressure_minus100_to100: -45,
          microstructure_confidence_0_100: 85
        },
        execution_context_gate: 'BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA',
        data_quality: { confidence_0_100: 85 },
        venue_price_check: { material_mismatch: false }
      },
      AAVE: { available: false },
      ADA: {
        available: true,
        scores: {
          trap_risk_0_100: 59,
          crowding_risk_0_100: 25,
          spot_confirmation_0_100: 40,
          persistent_wall_pressure_minus100_to100: -100,
          microstructure_confidence_0_100: 85
        },
        execution_context_gate: 'WAIT_FOR_RETEST_OR_CONFIRMATION',
        data_quality: { confidence_0_100: 85 },
        venue_price_check: { material_mismatch: false }
      }
    }
  },
  defi_fundamentals: {
    available: true,
    assets: {
      AAVE: {
        evaluation: { fundamental_quality_0_100: 11, confirmation: 'contradicts' },
        coverage: { successful_metric_families: 3, requested_metric_families: 4 },
        tvl: { change_7d_pct: -5.5 },
        fees: { momentum_7d_vs_prior7d_pct: -35 },
        revenue: { momentum_7d_vs_prior7d_pct: -25 }
      }
    }
  }
};

const consistency = evaluateDataConsistency(snapshot);
assert.ok(consistency.score_0_100 < 100);
assert.ok(consistency.conflicts.some(x => x.type === 'open_interest_24h_scope_conflict'));

const regime = buildRegimeEvidence(snapshot, {
  material: true,
  reasons: ['BTC:gate_WAIT_to_BLOCK','ADA:price_move_2.10pct']
});
assert.equal(regime.crypto_regime.classification, 'favorable');
assert.equal(regime.crypto_regime.shock_risk, 'high');
assert.equal(regime.macro_gate.position_change_allowed, false);

const evaluation = evaluateShadowV2({
  snapshotRow: {
    id: 99,
    generated_at: at,
    payload: snapshot,
    material_event: {
      material: true,
      reasons: ['BTC:gate_WAIT_to_BLOCK','AAVE:fundamental_quality_delta_-25','ADA:price_move_2.10pct']
    }
  },
  recentSnapshots: []
});
assert.equal(evaluation.execution_enabled, false);
assert.equal(evaluation.assets.BTC.action, 'HOLD');
assert.ok(evaluation.assets.BTC.blockers.includes('microstructure:block_new_entry'));
assert.equal(evaluation.assets.AAVE.posture, 'FUNDAMENTAL_VETO');
assert.equal(evaluation.assets.ADA.posture, 'WAIT_RETEST_OR_CONFIRMATION');

// price_source_diagnostic_regression: a venue midpoint may be valid for
// observed research prices but does not automatically qualify for an entry.
const microOnly = {
  generated_at: at,
  assets: ['BTC'],
  quotes: null,
  microstructure: { assets: {
    BTC: { available: true, minor_currency: 'usd', order_book: { mid: 100 } }
  } }
};
assert.equal(extractUsdPrices(microOnly).BTC, 100);
const consistencyMissing = evaluateDataConsistency(microOnly);
assert.ok(consistencyMissing.asset_blocks.BTC.includes('missing_positive_usd_price'));
assert.equal(consistencyMissing.blocking, true);

console.log('learning-v2-selftest: ok');
