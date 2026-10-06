# Upgrade v0.6.1 — Fundamental DeFi Sidecar

v0.6.1 intentionally keeps the v0.6 crypto/microstructure core unchanged and adds only one new evidence family: **DefiLlama fundamentals**.

## What changed

- New public, read-only DefiLlama client. No API key required.
- New `defi_fundamentals` section inside `trading_snapshot` for supported portfolio DeFi assets. v0.6.1 maps `AAVE -> aave` deliberately and conservatively.
- AAVE context now includes:
  - TVL current / 7d / 30d momentum when historical data is available.
  - Fees 24h / 7d and 7d-vs-prior-7d momentum.
  - Revenue 24h / 7d and 7d-vs-prior-7d momentum.
  - Global stablecoin-liquidity context (explicitly labeled as market context, not Aave-specific).
  - `fundamental_quality_0_100`, confidence, and `confirms / neutral / contradicts`.
- New `defi_protocol_research` MCP tool for on-demand research of future DeFi opportunity candidates by DefiLlama protocol slug.
- Default cache: 6 hours. This prevents slow-moving fundamentals from being polled every price snapshot.
- CMC call budget remains unchanged: max 9 core CMC calls for BTC/AAVE/ADA.
- Bitso logic is unchanged from v0.6.

## Guardrail

DefiLlama fundamentals **cannot independently create a BUY**. They may confirm, degrade, or veto an existing thesis. Missing metrics are never inferred.

## Render variables

No new secret is required. Optional/default variables:

```text
DEFILLAMA_ENABLED=true
DEFILLAMA_BASE_URL=https://api.llama.fi
DEFILLAMA_TIMEOUT_MS=12000
DEFILLAMA_CACHE_MS=21600000
```

Keep the existing CMC/OAuth/Bitso variables unchanged.

## Verify after deploy

1. `/healthz` should show `"version":"0.6.1"`.
2. Generate the usual BTC,AAVE,ADA snapshot.
3. Confirm a `defi_fundamentals` object appears.
4. Under `defi_fundamentals.assets.AAVE`, inspect TVL, fees, revenue, stablecoin context and evaluation.
5. If DefiLlama is temporarily unavailable, CMC + Bitso remain valid and the snapshot should contain an error only in the fundamental sidecar.
