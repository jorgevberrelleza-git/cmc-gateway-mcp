# CMC Gateway MCP

A read-only Model Context Protocol gateway for CoinMarketCap. It keeps the CoinMarketCap API key on the server, proxies the 12 official CMC MCP tools, and adds two composite tools tailored for trading research:

- `market_report`: global market + technicals + derivatives + narratives + catalysts + BTC/ETH anchors.
- `asset_research`: identity + quote + project info + holders + technical analysis + recent news for one token.

It **cannot place trades** and does not connect to Bitso.

## Why this exists

CoinMarketCap's MCP endpoint expects the API key in `X-CMC-MCP-API-KEY`. This gateway stores that key as a server-side environment variable, adds rate limiting and an allow-list, and gives us a stable endpoint we can later extend with decision logging and portfolio logic.

CoinMarketCap upstream endpoint: `https://mcp.coinmarketcap.com/mcp`.

## Tools exposed

Official CMC passthrough tools:

- `search_cryptos`
- `get_crypto_quotes_latest`
- `get_crypto_info`
- `get_crypto_metrics`
- `get_crypto_technical_analysis`
- `get_crypto_latest_news`
- `search_crypto_info`
- `get_global_metrics_latest`
- `get_global_crypto_derivatives_metrics`
- `get_crypto_marketcap_technical_analysis`
- `trending_crypto_narratives`
- `get_upcoming_macro_events`

Gateway helpers:

- `market_report`
- `asset_research`
- `cmc_list_upstream_tools` — schema diagnostic
- `cmc_raw_call` — allow-listed escape hatch if CMC changes a wrapper schema

## 1. Local setup

Requirements: Node.js 20+.

```bash
cp .env.example .env
```

Put your key in `.env`:

```text
CMC_MCP_API_KEY=YOUR_REAL_KEY
```

Do **not** paste the key into ChatGPT, commit it, or put it in client-side code.

Load the variables and install dependencies:

```bash
set -a
source .env
set +a
npm install
npm run check
npm start
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

In another terminal, list the gateway tools:

```bash
set -a
source .env
set +a
npm run smoke
```

To make one live CMC call during the smoke test:

```bash
RUN_LIVE_CMC=true npm run smoke
```

## 2. Authentication

For localhost you can leave `GATEWAY_BEARER_TOKEN` blank.

For **any public deployment**, set a long random `GATEWAY_BEARER_TOKEN`. The gateway will refuse to start in production without one unless `ALLOW_INSECURE=true` is explicitly set.

Clients then send:

```text
Authorization: Bearer YOUR_GATEWAY_TOKEN
```

The CMC key never leaves the server.

## 3. Deploy

### Render

This repository includes `render.yaml` and a Dockerfile.

1. Create a new Render Blueprint/Web Service from the repository.
2. Add the secret environment variable `CMC_MCP_API_KEY`.
3. Let Render generate `GATEWAY_BEARER_TOKEN`, or set your own strong value.
4. Deploy.
5. Verify `https://YOUR-SERVICE/healthz`.
6. MCP endpoint is `https://YOUR-SERVICE/mcp`.

### Railway

The included `railway.toml` and Dockerfile work with a Docker deployment.

Set these secrets in Railway:

- `CMC_MCP_API_KEY`
- `GATEWAY_BEARER_TOKEN`

Then expose the generated public domain and use `/mcp` as the endpoint.

## 4. Connect an MCP client

A client that supports custom request headers can use:

```json
{
  "mcpServers": {
    "cmc-gateway": {
      "url": "https://YOUR-SERVICE/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_GATEWAY_TOKEN"
      }
    }
  }
}
```

### Important for ChatGPT

ChatGPT custom-MCP availability and authentication support depend on the current plan/workspace and can change. A bearer-protected gateway is intentionally safer than exposing the CMC key. If the ChatGPT client you use cannot attach a static bearer token, the next step is to add an OAuth layer to this gateway (or use CoinMarketCap's browser-auth flow directly if supported by that client). Do **not** solve this by publishing the gateway without authentication.

## 5. First research workflow

Once connected, test:

1. `market_report`
2. `asset_research` with `AAVE`
3. `asset_research` with `ADA`
4. `asset_research` with `BTC`

That gives the first structured baseline for the trading-decision dataset.

## Guardrails in v0.1

- Read-only CMC allow-list.
- No Bitso execution.
- CMC key only in server environment.
- Optional inbound bearer authentication.
- Production startup guard against unauthenticated public exposure.
- In-memory upstream call limiter, default 25/minute.
- Per-call timeout.
- Partial results in composite tools if one upstream CMC tool fails.
- Diagnostic tool for upstream schema changes.

## Next version

Recommended additions after the gateway is successfully connected:

- OAuth authentication for ChatGPT-native browser login.
- Persistent decision ledger (Postgres/SQLite).
- Portfolio snapshot tool for AAVE/ADA/BTC/ANTW/USD.
- Technical + sentiment scoring output.
- 4h/24h/7d/30d outcome evaluator.
- Shadow-trader module.
- Bitso read-only balances/order-book connector.

Execution permissions should remain separate until the shadow system has enough validated history.
