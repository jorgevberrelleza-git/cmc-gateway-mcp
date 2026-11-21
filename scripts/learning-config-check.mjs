import { validateShadowRuntimeConfig } from '../src/learning/runtime-config.mjs';

const result = validateShadowRuntimeConfig(process.env, {
  requireDatabase: String(process.env.LEARNING_CONFIG_REQUIRE_DATABASE || 'true').toLowerCase() !== 'false'
});

console.log(JSON.stringify(result, null, 2));
if (!result.ready_for_shadow) process.exitCode = 1;
