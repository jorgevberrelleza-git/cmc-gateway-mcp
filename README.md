# CMC Gateway MCP v0.6 — Adaptive Microstructure Engine v3

Read-only CoinMarketCap + Bitso gateway for the Trading Snapshot workflow used with ChatGPT Plus. v0.6 keeps the same OAuth/MCP foundation and does **not** execute orders.

## What v0.6 changes

The v0.5 live test exposed two evidence-quality issues: an 18-second window can contain zero live trades, and a 100% cancellation share is easy to over-interpret when the sample has no observed completions or live fills. v0.6 addresses both without adding CoinMarketCap calls.

### 1. Adaptive Bitso capture

`BITSO_CAPTURE_MS` is now the **minimum** capture window. The WebSocket can continue up to `BITSO_CAPTURE_MAX_MS` while waiting for `BITSO_MIN_LIVE_TRADES`. Defaults:

```text
BITSO_CAPTURE_MS=18000
BITSO_CAPTURE_MAX_MS=45000
BITSO_MIN_LIVE_TRADES=3
```

All assets are still captured in parallel. The snapshot reports the actual capture duration and stop reason (`live_trade_target_met`, `max_capture_reached`, etc.).

### 2. Cancellation evidence quality

Cancellation share still uses only matched orders first observed OPEN during the capture and later resolved. New in v0.6: when the capture contains **no completed lifecycle and no live trade**, cancellation-only evidence is explicitly labeled `cancellation_only_context` and receives reduced trap-risk weight. This prevents a quiet market-maker refresh cycle from dominating the trap score.

### 3. REST trade freshness

The last 100 REST trades now receive a `freshness_0_100` score based on both how old the newest trade is and how many hours the sample spans. Old, slow-flow samples receive less influence in `spot_confirmation`.

### 4. Persistent wall pressure

Stable walls are separated from trap evidence. The engine now returns `persistent_wall_pressure` from -100 to +100:

- negative: nearby persistent ask/supply pressure
- positive: nearby persistent bid/support pressure
- near zero: balanced/weak

This is directional execution context, **not evidence of manipulation**.

### 5. Existing protections retained

- max 9 CMC calls for the 3-asset core snapshot
- BTC/AAVE/ADA technicals and relative strength
- Bitso spread/depth, order-book imbalance, matched lifecycles, wall persistence, sweep/rejection heuristic
- trap/crowding/spot-confirmation scores
- venue-price checks where direct USD comparison is possible
- OAuth and read-only MCP tools remain intact
- no Bitso private API key and no order execution

## Upgrade

1. Replace the repository contents with this v0.6 folder and commit to `main`.
2. Keep all existing secrets.
3. Recommended Render variables:

```text
CMC_MAX_CALLS_PER_MINUTE=9
BITSO_CAPTURE_MS=18000
BITSO_CAPTURE_MAX_MS=45000
BITSO_MIN_LIVE_TRADES=3
BITSO_TIMEOUT_MS=12000
BITSO_PREFERRED_MINORS=mxn,usd,usdc,usdt
```

4. After Render redeploys, `/healthz` should show `"version":"0.6.0"`.
5. Open `/snapshot`, keep the minimum capture at 18 seconds, generate BTC/AAVE/ADA, and copy the result into ChatGPT. Depending on trade activity, the request can take up to ~45 seconds.

## Interpretation rule

A high trap score is not proof of spoofing/manipulation/stop hunting. Stable persistent asks can simply represent genuine overhead supply. Cancellation-only samples are down-weighted. Low spot-confirmation confidence cannot create a trade signal.
