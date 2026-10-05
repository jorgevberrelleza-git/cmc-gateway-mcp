# Upgrade to v0.3 — Trading Snapshot Console

v0.3 keeps the existing OAuth/MCP gateway and adds a private browser console for ChatGPT Plus users.

## What is new

- `GET /snapshot` — private-use browser UI (the page itself contains no secrets).
- `POST /api/snapshot` — protected by your existing `OAUTH_LOGIN_SECRET`.
- One-click BTC/AAVE/ADA CoinMarketCap snapshot.
- One-click **Copy JSON**.
- One-click **Copy for ChatGPT**, which prepends the trading-engine analysis instruction.
- Snapshot request throttling to protect CoinMarketCap credits.
- The existing OAuth endpoints and `/mcp` remain intact for a future ChatGPT Pro connection.

## Render upgrade

1. Replace the repository files with the v0.3 files and commit to `main`.
2. Keep all existing Render secrets unchanged:
   - `CMC_MCP_API_KEY`
   - `OAUTH_LOGIN_SECRET`
   - `OAUTH_SIGNING_SECRET`
   - `ALLOW_LEGACY_BEARER=false`
3. Optional environment variable:
   - `SNAPSHOT_MAX_REQUESTS_PER_10_MIN=6`
4. Let Render redeploy.
5. Confirm `/healthz` reports `"version":"0.3.0"`.
6. Open `/snapshot`.
7. Enter the same value you configured as `OAUTH_LOGIN_SECRET`, then click **Generar Trading Snapshot**.

## Security notes

- Never paste the CMC API key into the console.
- The browser console uses only `OAUTH_LOGIN_SECRET` to authorize the request to your gateway.
- The CMC API key remains server-side in Render.
- The snapshot endpoint is read-only and cannot place trades or connect to Bitso.
- The console does not persist your login secret or snapshot in a database.

## Recommended workflow

1. Generate a snapshot only when you are about to make/review a decision.
2. Click **Copiar para ChatGPT**.
3. Paste into the existing Asesor Crypto chat.
4. ChatGPT combines the structured CMC evidence with the portfolio context, current web research, risk rules, and learned decision framework.
5. Record the resulting decision and later outcome as part of the training dataset.
