import { createLearningStore } from '../src/learning/storage.mjs';
import { evaluateShadowV2 } from '../src/learning/shadow-v2.mjs';
import { extractLearningFeatures, extractUsdPrices, quoteExtractionDiagnostics } from '../src/learning/features.mjs';

const store = createLearningStore();

try {
  const latest = await store.latestSnapshot();
  if (!latest) throw new Error('no_snapshot_available_for_v02');

  const recentDesc = await store.recentSnapshots(8);
  const recent = [...recentDesc].reverse().filter(x => Date.parse(x.generated_at) <= Date.parse(latest.generated_at));
  const evaluation = evaluateShadowV2({ snapshotRow: latest, recentSnapshots: recent });
  const saved = await store.saveShadowV2Evaluation(evaluation);
  const featurePrices = extractLearningFeatures(latest.payload).assets;
  const observedPrices = extractUsdPrices(latest.payload);
  const priceAvailability = Object.fromEntries(
    Object.keys(featurePrices).map(asset => {
      const primary = Number(featurePrices[asset]?.price_usd);
      const observed = Number(observedPrices[asset]);
      const minor = String(latest.payload?.microstructure?.assets?.[asset]?.minor_currency || '').toLowerCase();
      return [asset, {
        primary_quote_price_available: Number.isFinite(primary) && primary > 0,
        fallback_usd_venue_mid_available: !(Number.isFinite(primary) && primary > 0) &&
          ['usd','usdc','usdt'].includes(minor) && Number.isFinite(observed) && observed > 0,
        venue_currency: minor || null
      }];
    })
  );

  console.log(JSON.stringify({
    ok: true,
    snapshot_id: latest.id,
    saved: Boolean(saved),
    strategy_version: evaluation.strategy_version,
    regime: evaluation.regime.crypto_regime,
    consistency_score: evaluation.consistency.score_0_100,
    consistency_blocking: evaluation.consistency.blocking,
    consistency_diagnostics: {
      market_age_minutes: evaluation.consistency.market_age_minutes,
      asset_blocks: evaluation.consistency.asset_blocks,
      conflicts: evaluation.consistency.conflicts,
      warnings: evaluation.consistency.warnings,
      price_availability: priceAvailability,
      policy_unchanged: true
    },
    asset_postures: Object.fromEntries(Object.entries(evaluation.assets).map(([k,v]) => [k, v.posture])),
    external_research_trigger: evaluation.external_research_trigger,
    quote_parser_diagnostics: quoteExtractionDiagnostics(latest.payload),
    quote_provenance: latest.payload?.quote_provenance || null,
    execution_enabled: false
  }));
} finally {
  await store.close();
}
