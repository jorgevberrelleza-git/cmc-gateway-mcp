# CMC Gateway MCP v0.6.1

Read-only OAuth-protected trading-research gateway for the Asesor Crypto workflow.

## Core architecture

- **CoinMarketCap MCP** — market regime, quotes, technicals, derivatives, narratives, macro/event context and relative strength.
- **Bitso public REST/WebSocket** — local execution-context microstructure: spread/depth, matched order lifecycles, adaptive live-trade capture, persistent walls, spot confirmation, trap/crowding heuristics and data confidence.
- **DefiLlama Free API** — slow-moving DeFi fundamentals used only as a confirmation/degradation layer: TVL, fees, revenue and global stablecoin-liquidity context.

The service is decision support only. `execution_enabled` is false and no exchange write/trading endpoint is included.

## Recommended tool

Use `trading_snapshot` for the normal BTC/AAVE/ADA review. v0.6.1 keeps the v0.6 CMC/Bitso core and adds `defi_fundamentals` for supported DeFi positions (currently AAVE).

Use `defi_protocol_research` only when the Opportunity Scanner identifies a new DeFi candidate that deserves fundamental due diligence.

## Fundamental guardrail

A strong DefiLlama reading is **not** a buy signal. Fundamentals may confirm, degrade or veto a thesis that already exists from price/relative-strength/catalyst/risk evidence. Missing fields must not be inferred.

## CMC free-tier budget

The core snapshot remains at at most 9 CMC calls for the default three assets:

- 5 market/regime calls
- 1 batched quotes call
- 3 per-asset technical calls

DefiLlama does not consume CMC credits.

## DefiLlama configuration

The free API does not require a key. Defaults:

```text
DEFILLAMA_ENABLED=true
DEFILLAMA_BASE_URL=https://api.llama.fi
DEFILLAMA_TIMEOUT_MS=12000
DEFILLAMA_CACHE_MS=21600000
```

The 6-hour cache is intentional because protocol fundamentals generally move much more slowly than market microstructure.

## Existing security rules

- Keep `CMC_MCP_API_KEY`, `OAUTH_LOGIN_SECRET`, and `OAUTH_SIGNING_SECRET` only in Render environment variables.
- Keep `ALLOW_LEGACY_BEARER=false` after OAuth works.
- Do not enable insecure public access.
- Bitso access is public/read-only; v0.6.1 requires no Bitso private API key.
- Future exchange execution must remain a separate component with no withdrawal permission.

## Deploy

Deploy the Docker service exactly as v0.6. After Render finishes, open `/healthz`; it should report `0.6.1`. Then open `/snapshot` and generate BTC,AAVE,ADA.

See `UPGRADE-V0.6.1.md` for the incremental change.
