import crypto from 'node:crypto';

const SUPPORTED_ASSETS = new Set(['BTC','AAVE','ADA']);
const TRUE = new Set(['true','1','yes','on']);
const FALSE = new Set(['false','0','no','off','']);

function bool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return null;
}

function n(value, fallback) {
  if (value == null || value === '') return fallback;
  const x = Number(value);
  return Number.isFinite(x) ? x : NaN;
}

function parseAssets(value = 'BTC,AAVE,ADA') {
  return [...new Set(String(value).split(',').map(x => x.trim().toUpperCase()).filter(Boolean))];
}

function httpsUrl(value) {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; }
  catch { return false; }
}

export function validateShadowRuntimeConfig(env = process.env, { requireDatabase = true } = {}) {
  const errors = [];
  const warnings = [];
  const assets = parseAssets(env.LEARNING_ASSETS);
  const reasoningEnabled = bool(env.LEARNING_REASONING_ENABLED, false);
  const microEnabled = bool(env.LEARNING_INCLUDE_MICROSTRUCTURE, true);
  const webSearch = bool(env.LEARNING_REASONING_WEB_SEARCH, false);

  if (requireDatabase && !env.DATABASE_URL) errors.push('DATABASE_URL_required');
  if (!assets.length || assets.length > 3) errors.push('LEARNING_ASSETS_must_have_1_to_3_assets');
  for (const asset of assets) if (!SUPPORTED_ASSETS.has(asset)) errors.push(`unsupported_learning_asset:${asset}`);

  const captureMs = n(env.LEARNING_CAPTURE_MS, 18000);
  if (!Number.isFinite(captureMs) || captureMs < 6000 || captureMs > 45000) errors.push('LEARNING_CAPTURE_MS_out_of_range');
  if (microEnabled !== true) warnings.push('microstructure_disabled_reduces_learning_quality');

  if (reasoningEnabled == null) errors.push('LEARNING_REASONING_ENABLED_invalid_boolean');
  const provider = String(env.LEARNING_REASONING_PROVIDER || 'disabled').toLowerCase();
  if (reasoningEnabled === true) {
    if (!['mock','openai_responses'].includes(provider)) errors.push('reasoning_enabled_requires_supported_provider');
    if (provider === 'openai_responses') {
      if (!env.OPENAI_API_KEY) errors.push('OPENAI_API_KEY_required_for_openai_reasoning');
      if (!env.LEARNING_REASONING_MODEL) errors.push('LEARNING_REASONING_MODEL_required_for_openai_reasoning');
      if (webSearch !== true) warnings.push('web_search_disabled_position_changes_will_fail_macro_attestation');
    }
  }
  if (provider === 'openai_responses' && env.OPENAI_BASE_URL && !httpsUrl(env.OPENAI_BASE_URL)) {
    errors.push('OPENAI_BASE_URL_must_be_https');
  }

  const maxItems = n(env.LEARNING_REASONING_MAX_ITEMS, 3);
  if (!Number.isFinite(maxItems) || maxItems < 1 || maxItems > 3) errors.push('LEARNING_REASONING_MAX_ITEMS_out_of_range');

  const maxOutput = n(env.LEARNING_REASONING_MAX_OUTPUT_TOKENS, 1800);
  if (!Number.isFinite(maxOutput) || maxOutput < 500 || maxOutput > 4000) errors.push('LEARNING_REASONING_MAX_OUTPUT_TOKENS_out_of_range');

  const eventAge = n(env.LEARNING_REASONING_MAX_EVENT_AGE_HOURS, 6);
  if (!Number.isFinite(eventAge) || eventAge < 1 || eventAge > 24) errors.push('LEARNING_REASONING_MAX_EVENT_AGE_HOURS_out_of_range');

  const staleMinutes = n(env.LEARNING_REASONING_STALE_MINUTES, 30);
  if (!Number.isFinite(staleMinutes) || staleMinutes < 5 || staleMinutes > 120) errors.push('LEARNING_REASONING_STALE_MINUTES_out_of_range');

  const maxRisk = n(env.LEARNING_MAX_RISK_PCT, 0.01);
  const defaultRisk = n(env.LEARNING_DEFAULT_RISK_PCT, 0.005);
  const maxPosition = n(env.LEARNING_MAX_POSITION_PCT, 0.20);
  const maxNewExposure = n(env.LEARNING_MAX_NEW_EXPOSURE_PCT, 0.10);
  if (!Number.isFinite(maxRisk) || maxRisk <= 0 || maxRisk > 0.01) errors.push('LEARNING_MAX_RISK_PCT_must_be_0_to_1pct');
  if (!Number.isFinite(defaultRisk) || defaultRisk <= 0 || defaultRisk > maxRisk) errors.push('LEARNING_DEFAULT_RISK_PCT_must_be_positive_and_lte_max');
  if (!Number.isFinite(maxPosition) || maxPosition <= 0 || maxPosition > 0.30) errors.push('LEARNING_MAX_POSITION_PCT_must_be_0_to_30pct');
  if (!Number.isFinite(maxNewExposure) || maxNewExposure <= 0 || maxNewExposure > 0.15) errors.push('LEARNING_MAX_NEW_EXPOSURE_PCT_must_be_0_to_15pct');

  const feeRate = n(env.LEARNING_PAPER_FEE_RATE, 0.001);
  const slippage = n(env.LEARNING_PAPER_SLIPPAGE_BPS, 10);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.01) errors.push('LEARNING_PAPER_FEE_RATE_out_of_range');
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) errors.push('LEARNING_PAPER_SLIPPAGE_BPS_out_of_range');

  const forbiddenSecrets = [
    'BITSO_API_KEY','BITSO_API_SECRET','BITSO_KEY','BITSO_SECRET','BITSO_PRIVATE_KEY',
    'BITSO_PRIVATE_SECRET','BITSO_TRADING_KEY','BITSO_TRADING_SECRET'
  ].filter(key => Boolean(env[key]));
  for (const key of forbiddenSecrets) errors.push(`forbidden_shadow_runtime_secret:${key}`);

  const dangerousFlags = ['EXECUTION_ENABLED','BITSO_EXECUTION_ENABLED','TRADING_ENABLED','LEARNING_EXECUTION_ENABLED']
    .filter(key => bool(env[key], false) === true);
  for (const key of dangerousFlags) errors.push(`real_execution_flag_forbidden:${key}`);

  if (String(env.ALLOW_INSECURE || '').toLowerCase() === 'true') errors.push('ALLOW_INSECURE_must_not_be_true');

  const normalized = {
    assets,
    capture_ms: captureMs,
    microstructure_enabled: microEnabled === true,
    reasoning_enabled: reasoningEnabled === true,
    reasoning_provider: provider,
    reasoning_model: env.LEARNING_REASONING_MODEL || null,
    web_search_enabled: webSearch === true,
    max_reasoning_items: maxItems,
    max_output_tokens: maxOutput,
    max_event_age_hours: eventAge,
    stale_minutes: staleMinutes,
    max_risk_pct: maxRisk,
    default_risk_pct: defaultRisk,
    max_position_pct: maxPosition,
    max_new_exposure_pct: maxNewExposure,
    paper_fee_rate: feeRate,
    paper_slippage_bps: slippage,
    execution_enabled: false
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

  return {
    ready_for_shadow: errors.length === 0,
    errors,
    warnings,
    normalized,
    config_fingerprint: fingerprint,
    secret_values_included: false
  };
}
