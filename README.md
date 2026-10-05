# CMC Gateway MCP v0.3.1

Private, read-only CoinMarketCap gateway for the Asesor Crypto trading-engine experiment.

v0.3.1 supports two parallel workflows:

1. **ChatGPT Plus now:** use the private `/snapshot` console to generate structured BTC/AAVE/ADA market evidence and paste it into the existing chat.
2. **ChatGPT Pro later:** use the existing OAuth-protected `/mcp` endpoint directly from ChatGPT Developer Mode.

It cannot place trades, cannot withdraw funds, and does not connect to Bitso.

## Trading Snapshot Console

Open:

`https://YOUR-SERVICE.onrender.com/snapshot`

Enter your existing `OAUTH_LOGIN_SECRET`, keep `BTC,AAVE,ADA`, and click **Generar Trading Snapshot**.

The snapshot combines:

- global crypto metrics and sentiment context;
- total-market technical analysis;
- global derivatives positioning;
- trending narratives;
- upcoming macro/events;
- BTC/ETH quotes;
- per-asset quote, project info, holder metrics, technical analysis and recent news.

Use **Copiar para ChatGPT** to copy a prompt-ready package into the Asesor Crypto conversation.

### Snapshot protection

`POST /api/snapshot` requires the existing `OAUTH_LOGIN_SECRET` via a private request header. The API key is never sent to the browser. Requests are throttled by IP to reduce accidental credit consumption.

Default limit: `6` snapshots per 10 minutes per IP. Configure with:

`SNAPSHOT_MAX_REQUESTS_PER_10_MIN`

## MCP tools retained

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
- `cmc_list_upstream_tools`
- `cmc_raw_call`

## OAuth endpoints retained for future Pro use

- MCP resource: `/mcp`
- Protected Resource Metadata: `/.well-known/oauth-protected-resource`
- Authorization Server Metadata: `/.well-known/oauth-authorization-server`
- Dynamic Client Registration: `/oauth/register`
- Authorization: `/oauth/authorize`
- Token: `/oauth/token`
- Revocation: `/oauth/revoke`
- Health: `/healthz`

OAuth uses authorization code + PKCE S256.

## Required Render secrets

- `CMC_MCP_API_KEY`
- `OAUTH_LOGIN_SECRET` (16+ characters)
- `OAUTH_SIGNING_SECRET` (32+ characters; 64+ recommended)

Recommended settings:

- `ALLOW_LEGACY_BEARER=false`
- `CMC_MAX_CALLS_PER_MINUTE=25`
- `CMC_TIMEOUT_MS=20000`
- `SNAPSHOT_MAX_REQUESTS_PER_10_MIN=6`

On Render, `RENDER_EXTERNAL_URL` is used automatically as the public base URL.

## Development

```bash
npm install
npm run check
npm run oauth:selftest
npm start
```

Never commit secrets.

## Architecture

Current:

`CoinMarketCap MCP -> CMC Gateway -> /snapshot -> ChatGPT Plus -> human execution`

Future:

`Market data -> Quant/AI engines -> Risk engine -> Decision API -> Bitso execution`

The AI decision layer and future exchange execution should remain separated by deterministic risk controls and audited authorization.
