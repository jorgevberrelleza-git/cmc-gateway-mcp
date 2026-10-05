# Upgrade to v0.5 — Microstructure Engine

v0.5 adds a **read-only Bitso microstructure layer** on top of the existing CoinMarketCap core snapshot.

## What is new

- Bitso public book discovery via `GET /available_books/`.
- Bitso public aggregated order book and recent trades.
- Short public WebSocket capture of `orders`, `trades`, and `diff-orders`.
- Per-asset metrics:
  - spread in basis points;
  - depth within 10/25/50 bps;
  - bid/ask imbalance;
  - aggressive buy/sell flow from recent trades;
  - live order-book imbalance and sign flips;
  - observed cancellation/completion share;
  - large, fast cancellations observed during the capture;
  - sequence-gap/data-quality checks.
- Heuristic scores:
  - `trap_risk_0_100`;
  - `crowding_risk_0_100`;
  - `spot_confirmation_0_100`.
- `execution_context_gate` can return:
  - `NORMAL_REVIEW`;
  - `WAIT_FOR_RETEST_OR_CONFIRMATION`;
  - `BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA`.
- New MCP tools for the future Pro connection:
  - `bitso_microstructure`;
  - `trading_snapshot`.

## Important limitation

The microstructure scores are **heuristics**. They can identify footprints consistent with crowded positioning, unstable liquidity, fast cancellation behavior, or weak spot confirmation. They do **not** prove spoofing, manipulation, whale intent, or stop-hunting.

## Upgrade steps on your existing Render service

1. Replace the repository contents with v0.5 and commit to `main`.
2. Let Render auto-deploy.
3. Keep all existing secrets unchanged:
   - `CMC_MCP_API_KEY`
   - `OAUTH_LOGIN_SECRET`
   - `OAUTH_SIGNING_SECRET`
4. Confirm `CMC_MAX_CALLS_PER_MINUTE=9` in Render.
5. Optional Bitso variables (defaults already exist in code):
   - `BITSO_REST_BASE=https://bitso.com/api/v3`
   - `BITSO_WS_URL=wss://ws.bitso.com`
   - `BITSO_CAPTURE_MS=6000`
   - `BITSO_TIMEOUT_MS=12000`
   - `BITSO_PREFERRED_MINORS=mxn,usd,usdc,usdt`
6. Open `/healthz`; it should show `"version":"0.5.0"`.
7. Open `/snapshot`, keep the Bitso capture at 6 seconds, and generate a snapshot.

No Bitso API key is required in v0.5. It uses public market-data endpoints only and cannot place, modify, or cancel orders.

## Expected snapshot fields

A successful snapshot should contain:

```text
snapshot_version: 0.5.0
snapshot_depth: core_plus_microstructure
microstructure.assets.BTC
microstructure.assets.AAVE
microstructure.assets.ADA
```

Each supported asset should include the selected Bitso book, spread/depth, recent trade flow, live microstructure, risk scores, flags, data quality, and the execution-context gate.
