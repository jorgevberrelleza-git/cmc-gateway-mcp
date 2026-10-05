# Upgrade to v0.5 — Microstructure Engine v2

v0.5 keeps the same read-only architecture and the same CoinMarketCap budget (maximum 9 CMC tool calls for a 3-asset core snapshot). No Bitso API key is required.

## Why this version exists

The v0.4 test showed an important statistical weakness: a short WebSocket capture could count cancellations for orders that had been opened before the capture started, while completions could be rare inside the same six-second window. That can overstate cancellation pressure.

v0.5 fixes that by separating **raw diff-order events** from **matched lifecycles**. Cancellation share is now computed only when the gateway observes an order first opening during the capture and then observes the same order cancelling or completing before the capture ends.

## New evidence layers

- matched `OPEN -> CANCELLED/COMPLETED` lifecycles
- longer capture window: default 18 s, selectable 6–30 s
- wall persistence from repeated top-book order IDs
- early / middle / late order-book imbalance
- normalized imbalance sign-flip rate per 10 seconds
- mid-price path and short-window sweep/rejection heuristic
- live taker-flow weighting above stale REST trade flow
- microstructure confidence score
- spot-confirmation confidence score
- USD/stablecoin venue-price basis check against CMC
- explicit BTC/ETH relative strength for 24 h, 7 d and 30 d
- confidence-aware execution gate

## Deploy

1. Replace the repository contents with v0.5 and commit to `main`.
2. Keep all existing secrets exactly as they are.
3. Recommended Render environment value:

   `BITSO_CAPTURE_MS=18000`

   The browser console can override this from 6 to 30 seconds per snapshot.
4. Keep:

   `CMC_MAX_CALLS_PER_MINUTE=9`

5. Wait for Render to redeploy.
6. Open `/healthz`; it should show `"version":"0.5.0"`.
7. Open `/snapshot`, leave the capture at 18 seconds, generate one snapshot, and copy it to ChatGPT.

## Important interpretation rule

A high trap score is not proof of spoofing, manipulation, or stop hunting. A low-confidence microstructure capture cannot create a trade signal. v0.5 uses Bitso only as execution-context evidence.
