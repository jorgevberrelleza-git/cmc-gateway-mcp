# Historical upgrade notes — OAuth v0.2

This release adds OAuth 2.1-style authorization-code + PKCE (S256) for ChatGPT MCP linking.
It remains read-only and cannot trade.

## Render environment variables

Keep:
- `CMC_MCP_API_KEY` = your existing CoinMarketCap secret

Add:
- `OAUTH_LOGIN_SECRET` = a memorable but strong private passphrase (minimum 16 characters). You will type this only on your gateway's authorization page when ChatGPT asks you to connect.
- `OAUTH_SIGNING_SECRET` = a long random secret, ideally 64+ characters. Render can generate one.
- `ALLOW_LEGACY_BEARER=false`

Optional; Render already supplies this automatically:
- `PUBLIC_BASE_URL=https://cmc-gateway-mcp.onrender.com`

The code automatically uses Render's `RENDER_EXTERNAL_URL`, so `PUBLIC_BASE_URL` is only needed if you later add a custom domain or want to override the issuer URL.

## After deploy

Open these in a browser:

1. `https://cmc-gateway-mcp.onrender.com/healthz`
   - Expect `version: "0.2.0"` and `oauth: true`.

2. `https://cmc-gateway-mcp.onrender.com/.well-known/oauth-protected-resource`
   - Expect `authorization_servers` pointing to the gateway base URL.

3. `https://cmc-gateway-mcp.onrender.com/.well-known/oauth-authorization-server`
   - Expect `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, and `code_challenge_methods_supported: ["S256"]`.

Do not paste `OAUTH_LOGIN_SECRET`, `OAUTH_SIGNING_SECRET`, or your CMC key into ChatGPT.

## ChatGPT linking

Use the MCP URL:

`https://cmc-gateway-mcp.onrender.com/mcp`

Choose OAuth authentication. ChatGPT should dynamically register, open the gateway authorization page, and ask you for `OAUTH_LOGIN_SECRET`. Approve the read-only permission.

## Security model

- The CMC API key never leaves Render.
- ChatGPT receives a short-lived OAuth access token, not the CMC key.
- Access tokens are bound to the exact MCP resource URL and `cmc:read` scope.
- PKCE S256 protects the authorization-code exchange.
- Dynamic client registrations are stateless signed client IDs, so a Render restart does not erase the ChatGPT client registration.
- Authorization codes are short lived and additionally replay-blocked in memory for the current instance.
- Refresh tokens are supported for persistent connectivity.
- All MCP tools advertise `oauth2` + `cmc:read` and read-only annotations.
- No Bitso trading or write capability is present.

## Caveat in v0.2

Token revocation is best-effort because the server is stateless. Rotating `OAUTH_SIGNING_SECRET` immediately invalidates every access/refresh token and forces a fresh ChatGPT connection. This is acceptable for the current private, read-only research gateway. Before any future exchange write capability, move authorization state and revocation to a persistent identity provider or database-backed auth service.
