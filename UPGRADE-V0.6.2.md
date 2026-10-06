# Upgrade to v0.6.2 — DefiLlama resilience hotfix

This is a patch release only. The CMC and Bitso engines are unchanged.

## Why
The first live v0.6.1 snapshot reached DefiLlama successfully but AAVE returned a generic HTTP 404, causing the whole fundamental sidecar for AAVE to be discarded even though other metric families could still be valid.

## Changes
- DefiLlama metric families now fail independently; one 404 no longer erases TVL/stablecoin/other valid data.
- AAVE uses `aave` as the consolidated TVL slug and tries fee/revenue slugs in this order: `aave`, then `aave-v3`.
- If `aave-v3` is used as a flow fallback, the snapshot explicitly labels the mixed scope and reduces fundamental-confidence by 10 points.
- Adds endpoint-level errors, attempted flow slugs, coverage, and partial-data metadata.
- Missing metrics are still never inferred.
- Fundamentals still cannot create a BUY signal by themselves.

## Render
No new environment variables. Keep the existing v0.6.1 settings.

After deploy, `/healthz` should report `0.6.2`.
