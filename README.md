# CMC Gateway MCP v0.4 — CMC + Bitso Microstructure

A private, read-only decision-support gateway for the crypto trading experiment.

## Architecture

```text
CoinMarketCap MCP ─┐
                   ├─> CMC Gateway v0.4 ─> Trading Snapshot ─> ChatGPT decision process
Bitso public data ─┘
```

The service **cannot trade**. It has no Bitso private API key and uses only public market data.

## Core CMC layer

The core snapshot preserves the rate-limit-aware design introduced in v0.3.2:

- global market metrics;
- market technicals;
- global derivatives;
- narratives;
- upcoming events;
- batched quotes;
- BTC/AAVE/ADA technical analysis.

The maximum core budget remains 9 upstream CMC tool calls for the default three assets.

## v0.4 Microstructure Engine

For each requested asset the gateway discovers the relevant Bitso execution book and collects:

- aggregated order book;
- recent public trades;
- a short WebSocket sample of `orders`, `trades`, and `diff-orders`.

It then calculates:

- spread and depth;
- bid/ask imbalance;
- aggressive flow imbalance;
- cancellation/completion behavior observed during the sample;
- fast large cancellations observed within the capture window;
- book/flow divergence;
- data-quality checks;
- `trap_risk_0_100`;
- `crowding_risk_0_100`;
- `spot_confirmation_0_100`;
- an execution-context gate.

These are **decision-support heuristics, not proof of manipulation**.

## Web console

Open:

```text
https://YOUR-SERVICE.onrender.com/snapshot
```

Enter the existing `OAUTH_LOGIN_SECRET`, choose BTC/AAVE/ADA, and generate the snapshot. The default Bitso WebSocket capture is 6 seconds.

The **Copiar para ChatGPT** button adds instructions to evaluate the microstructure fields explicitly.

## MCP endpoints

The existing OAuth-protected MCP remains available at:

```text
/mcp
```

v0.4 adds two local read-only tools:

- `bitso_microstructure`
- `trading_snapshot`

All previous CMC tools remain available.

## Environment variables

Required existing variables:

```text
CMC_MCP_API_KEY=...
OAUTH_LOGIN_SECRET=...
OAUTH_SIGNING_SECRET=...
ALLOW_LEGACY_BEARER=false
CMC_MAX_CALLS_PER_MINUTE=9
```

Optional Bitso variables:

```text
BITSO_REST_BASE=https://bitso.com/api/v3
BITSO_WS_URL=wss://ws.bitso.com
BITSO_CAPTURE_MS=6000
BITSO_TIMEOUT_MS=12000
BITSO_PREFERRED_MINORS=mxn,usd,usdc,usdt
```

No Bitso credential is needed.

## Local checks

```bash
npm run check
npm run microstructure:selftest
```

The included self-test validates spread, aggressive-flow, imbalance-flip and fast-cancellation scoring logic with synthetic fixtures.

## Safety model

- read-only CoinMarketCap;
- read-only public Bitso market data;
- no withdrawal permissions;
- no place-order endpoint;
- no private Bitso credentials;
- heuristic signals never labelled as confirmed manipulation;
- missing or inconsistent microstructure data reduces confidence rather than silently creating a trade signal.

See `UPGRADE-V0.4.md` for deployment steps.
