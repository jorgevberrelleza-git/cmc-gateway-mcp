# CMC Gateway MCP v0.2

A private, read-only Model Context Protocol gateway for CoinMarketCap. It keeps the CoinMarketCap API key on the server, exposes the official CMC research tools plus composite trading-research tools, and now supports OAuth authorization-code + PKCE for ChatGPT MCP linking.

It **cannot place trades**, cannot withdraw funds, and does not connect to Bitso.

## Core tools

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
- `cmc_raw_call` (strictly allow-listed read-only tools)

## OAuth endpoints

- MCP resource: `/mcp`
- Protected Resource Metadata: `/.well-known/oauth-protected-resource`
- Authorization Server Metadata: `/.well-known/oauth-authorization-server`
- Dynamic Client Registration: `/oauth/register`
- Authorization: `/oauth/authorize`
- Token: `/oauth/token`
- Revocation: `/oauth/revoke`
- Health: `/healthz`

OAuth uses authorization code + PKCE S256. The gateway supports public dynamically registered clients (`token_endpoint_auth_method=none`) and issues short-lived access tokens plus refresh tokens.

## Required production secrets

- `CMC_MCP_API_KEY`
- `OAUTH_LOGIN_SECRET` (16+ characters)
- `OAUTH_SIGNING_SECRET` (32+ characters; 64+ recommended)

On Render, the server automatically uses `RENDER_EXTERNAL_URL` as its OAuth issuer/base URL. `PUBLIC_BASE_URL` can override it for a custom domain.

See `UPGRADE-OAUTH.md` for the exact Render upgrade steps.

## Development

```bash
npm install
npm run check
npm run oauth:selftest
npm start
```

For local development set `PUBLIC_BASE_URL`, `OAUTH_LOGIN_SECRET`, `OAUTH_SIGNING_SECRET`, and `CMC_MCP_API_KEY` in your shell. Never commit secrets.

## Security guardrails

- Read-only tool allow-list.
- Tool descriptors advertise OAuth `cmc:read` plus read-only annotations.
- CMC key remains server-side.
- OAuth access tokens are resource- and scope-bound.
- PKCE S256 enforced.
- Redirect URIs restricted to ChatGPT/OpenAI HTTPS hosts by default.
- Login brute-force throttling.
- Upstream rate limiter and per-call timeout.
- No exchange execution.

Before adding any future Bitso write action, use a persistent, audited identity provider and keep execution authorization separate from the AI decision layer.
