# Shadow Node.js security watch — 2026-10-23

## Trigger and verified source
The official Node.js security release of 2026-10-21 identifies **CVE-2026-111497**, an out-of-bounds write in the bundled Brotli decoder, which can lead to process crash, memory disclosure or remote code execution when an application decompresses attacker-controlled Brotli.
- Official: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- Fixed versions: Node 22.23.4, 24.22.1, 26.12.1 (or later on the corresponding supported major).

## Actual project exposure — **not yet verified**
- GitHub package.json engine currently permits Node >=22; this does not guarantee a patched version.
- Render **cron job** `cmc-learning-shadow-hourly` is a managed **node** runtime, NOT the Dockerfile's `node:22-alpine` image. A Dockerfile change alone would not fix the cron.
- The deployed Render cron remains at commit `ea9f48ca4426553551186589ef65604511aacf33`. Its current Node patch version is not recorded in the previously available cycle logs. **Do not claim it is vulnerable or patched without the actual runtime version.**
- The app makes outbound requests to external sources. Risk is conditional on receiving malicious Brotli-compressed content; there is no evidence of exploitation in this project.

## Implemented in research branch only
- `src/learning/node-runtime-security.mjs`: deterministic read-only classification of actual `process.version` against official fixed-version thresholds; no external calls, secrets or trading.
- `scripts/learning-node-security-selftest.mjs`: regression cases for vulnerable, patched, EOL, unknown and unverified versions, plus no-spend/no-execution assertions.
- `scripts/learning-hourly-cycle.mjs`: exposes `node_runtime_security` in cycle JSON for post-deployment verification without blocking the collector.
- `package.json` and Learning Engine CI: syntax and regression checks.
- CI for commit `8a82e28fe7240f453b8bc541c1886ba99984f618`: `validate` and `postgres-integration` passed (GitHub Actions runs 40054347863 and 40054351957). Documentation-only follow-up should be revalidated before any promotion.

## Acceptance / rollout gate
1. Both GitHub Actions jobs green for the final commit.
2. Check the actual Render runtime version; if vulnerable or unsupported, plan a patched runtime selection separately and test in staging before promotion.
3. Only after authorized deployment, require a real cycle with `node_runtime_security.status === 'patched'`, `cycle_status === 'success'`, BTC/ADA/AAVE all valid USD, `consistency_blocking === false`, `execution_enabled === false`, paid AI calls zero and no secrets in logs.
4. No changes to cron, keys, order permissions, budget, risk rules or trading.
5. Rollback: redeploy last known-good commit if the new code regresses. **Rolling back code is not a fix for a vulnerable Node runtime**; patch the runtime independently.

This is a **security observability improvement**, not proof of patching, improved returns, or statistical alpha.
