import { extractLearningFeatures } from './features.mjs';
import { evaluateDataConsistency } from './data-consistency.mjs';
import { buildRegimeEvidence } from './regime-evidence.mjs';

function materialReasonsByAsset(materialEvent = {}) {
  const out = {};
  for (const reason of materialEvent?.reasons || []) {
    const text = String(reason || '');
    const [rawAsset] = text.split(':');
    const asset = String(rawAsset || '').toUpperCase();
    if (!asset) continue;
    if (!out[asset]) out[asset] = [];
    out[asset].push(text);
  }
  return out;
}

function postureForAsset(asset, f, consistency, regime, reasons) {
  const blockers = [];
  const cautions = [];

  for (const reason of consistency?.asset_blocks?.[asset] || []) blockers.push(`data:${reason}`);
  if (consistency?.blocking && !(consistency?.asset_blocks?.[asset]?.length)) {
    cautions.push('global_data_consistency_reduced');
  }

  if (f?.execution_gate === 'BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA') blockers.push('microstructure:block_new_entry');
  if (f?.execution_gate === 'WAIT_FOR_RETEST_OR_CONFIRMATION') cautions.push('microstructure:wait_retest');
  if (Number(f?.trap_risk) >= 60) cautions.push('microstructure:trap_risk_high');
  if (Number(f?.crowding_risk) >= 70) cautions.push('microstructure:crowding_high');
  if (Number(f?.spot_confirmation) < 35) blockers.push('microstructure:weak_spot_confirmation');
  if (Number(f?.persistent_wall_pressure) <= -70) cautions.push('microstructure:overhead_supply');

  if (String(f?.fundamental_confirmation || '').toLowerCase() === 'contradicts'
      && Number(f?.fundamental_quality) <= 25) {
    blockers.push('fundamentals:veto_risk_on');
  }

  const catalystNeedsValidation = regime?.catalyst_gate?.primary_validation_required === true;
  if (catalystNeedsValidation) cautions.push('catalyst:primary_validation_required');
  if (regime?.crypto_regime?.shock_risk === 'high') cautions.push('regime:high_event_risk');

  let posture = 'OBSERVE';
  if (blockers.some(x => x.startsWith('data:'))) posture = 'DATA_BLOCKED';
  else if (blockers.includes('fundamentals:veto_risk_on')) posture = 'FUNDAMENTAL_VETO';
  else if (blockers.length || cautions.some(x => x.startsWith('microstructure:'))) posture = 'WAIT_RETEST_OR_CONFIRMATION';
  else if (catalystNeedsValidation) posture = 'WAIT_PRIMARY_CATALYST_VALIDATION';

  const material = reasons.length > 0;
  const researchCandidate = material
    && !blockers.some(x => x.startsWith('data:'))
    && (regime?.crypto_regime?.shock_risk === 'high'
      || reasons.some(x => /price_move_|gate_/i.test(x)));

  return {
    asset,
    action: 'HOLD',
    posture,
    position_change_allowed: false,
    blockers,
    cautions,
    material_reasons: reasons,
    research_candidate: researchCandidate,
    policy_reason: 'v0.2_is_filter_first_and_requires_verified_macro_news_before_any_position_change'
  };
}

export function evaluateShadowV2({ snapshotRow, recentSnapshots = [] } = {}) {
  if (!snapshotRow?.id) throw new Error('snapshot_row_required');
  const snapshot = snapshotRow.payload || {};
  const materialEvent = snapshotRow.material_event || {};
  const features = extractLearningFeatures(snapshot);
  const consistency = evaluateDataConsistency(snapshot);
  const regime = buildRegimeEvidence(snapshot, materialEvent);
  const byAsset = materialReasonsByAsset(materialEvent);

  const assets = {};
  for (const [asset, f] of Object.entries(features.assets || {})) {
    assets[asset] = postureForAsset(asset, f, consistency, regime, byAsset[asset] || []);
  }

  const researchAssets = Object.values(assets)
    .filter(x => x.research_candidate)
    .map(x => x.asset);

  const eventTitles = (regime?.catalyst_gate?.upcoming_72h || []).slice(0, 3).map(x => x.title).filter(Boolean);
  const triggerRequired = researchAssets.length > 0 && (
    regime?.crypto_regime?.shock_risk === 'high'
    || eventTitles.length > 0
  );

  return {
    strategy_version: 'shadow_v0.2',
    snapshot_id: snapshotRow.id,
    generated_at: snapshotRow.generated_at || snapshot?.generated_at || null,
    regime,
    consistency,
    assets,
    external_research_trigger: {
      required: triggerRequired,
      assets: researchAssets,
      reasons: triggerRequired
        ? ['material_event_plus_catalyst_or_high_event_risk']
        : [],
      event_titles: eventTitles,
      dedupe_key: triggerRequired
        ? `${String(snapshotRow.generated_at || '').slice(0, 10)}:${researchAssets.sort().join(',')}:${eventTitles.join('|')}`
        : null,
      execute_external_calls: false,
      policy: 'research trigger only; paid AI/web search remains disabled'
    },
    replay_context: {
      recent_snapshot_count: Array.isArray(recentSnapshots) ? recentSnapshots.length : 0,
      hindsight_used: false
    },
    execution_enabled: false
  };
}
