# CMC Gateway MCP v0.5 — Microstructure Engine v2

Private, read-only crypto decision-support gateway for ChatGPT Plus today and MCP/OAuth later.

## Architecture

```text
CoinMarketCap MCP ─┐
                   ├─> CMC Gateway v0.5 ─> Trading Snapshot ─> ChatGPT decision process
Bitso public data ─┘
```

The service **cannot trade**. It has no Bitso private API key and exposes no place/cancel-order endpoint.

## CMC CORE layer

The rate-limit-aware core remains capped at a maximum of 9 upstream CMC tool calls for the default BTC/AAVE/ADA snapshot:

- global market metrics;
- market technicals;
- global derivatives;
- narratives;
- upcoming events;
- one batched quote request for the requested assets plus ETH;
- one technical-analysis request per requested asset.

v0.5 also calculates explicit 24 h / 7 d / 30 d relative strength against BTC and ETH from the same batched quote data, so this adds no CMC calls.

## Bitso Microstructure Engine v2

For each asset with a public Bitso book, v0.5 collects:

- aggregated REST order book;
- 100 recent public trades;
- public WebSocket `orders`, `trades`, and `diff-orders` events;
- a default 18-second live capture (selectable 6–30 seconds).

### Key v0.5 fix: matched order lifecycles

Raw `diff-orders` cancellation messages can refer to orders that existed before our capture started. Therefore raw cancellation counts are no longer used as a direct cancellation-rate signal.

v0.5 computes cancellation share only from orders that are:

1. first observed opening during the capture; and
2. later observed as `cancelled` or `completed` during that same capture.

The snapshot still reports raw diff counts for context, but the trap score uses the matched lifecycle sample.

### New fields

- `matched_lifecycle`
- `wall_persistence`
- `imbalance_phase_means` (early / middle / late)
- `imbalance_flips_per_10s`
- `mid_path` with short-window sweep/rejection heuristic
- `stream_aggressive_flow_imbalance`
- `microstructure_confidence_0_100`
- `spot_confirmation_confidence_0_100`
- `venue_price_check` for USD/stablecoin books
- `relative_strength` against BTC/ETH
- confidence-aware `execution_context_gate`

The primary scores remain:

- `trap_risk_0_100`
- `crowding_risk_0_100`
- `spot_confirmation_0_100`

These are **heuristics**. They do not prove spoofing, manipulation, or stop-hunting.

## Browser console

Open:

```text
https://YOUR-SERVICE.onrender.com/snapshot
```

Use the existing `OAUTH_LOGIN_SECRET`.

Recommended first capture:

```text
18 seconds
```

Use 30 seconds when you want stronger microstructure evidence and can wait longer.

## MCP tools

OAuth-protected endpoint:

```text
/mcp
```

Local composite tools include:

- `market_report`
- `asset_research`
- `bitso_microstructure`
- `trading_snapshot`

All exchange-side functionality remains read-only.

## Environment

Required existing values:

```text
CMC_MCP_API_KEY=...
OAUTH_LOGIN_SECRET=...
OAUTH_SIGNING_SECRET=...
ALLOW_LEGACY_BEARER=false
CMC_MAX_CALLS_PER_MINUTE=9
```

Recommended v0.5 Bitso settings:

```text
BITSO_REST_BASE=https://bitso.com/api/v3
BITSO_WS_URL=wss://ws.bitso.com
BITSO_CAPTURE_MS=18000
BITSO_TIMEOUT_MS=12000
BITSO_PREFERRED_MINORS=mxn,usd,usdc,usdt
```

No Bitso credential is required.

## Checks

```bash
npm run check
npm run microstructure:selftest
```

## Safety rules

- CMC and Bitso are read-only.
- No private Bitso key is present.
- Low-confidence microstructure cannot create a trade signal.
- High trap/crowding risk requires retest or confirmation.
- Venue microstructure is execution context, not a trade command.
- Material catalysts should still be validated with primary/authoritative sources before changing real-money positions.

See `UPGRADE-V0.5.md` for deployment steps.
