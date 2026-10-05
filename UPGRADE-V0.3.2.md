# Upgrade to v0.3.2 — rate-limit aware core snapshot

This release fixes the upstream CoinMarketCap MCP `1008` rate-limit errors seen in v0.3.1.

## What changed

- Core BTC/AAVE/ADA snapshot is capped at **9 CMC tool calls**.
- Quotes are batched in a single call and include ETH as a benchmark.
- Known CMC IDs for BTC, ETH, ADA and AAVE avoid unnecessary search calls.
- Per-asset news, holder metrics and static project info moved out of the core snapshot. Use `asset_research` only when a setup deserves deep research.
- The gateway reuses one upstream MCP session and discovers tools once instead of reconnecting/listing schemas for every tool call.
- Local default pacing is now `CMC_MAX_CALLS_PER_MINUTE=9`.

## Deploy

Replace the current repository contents with this release, commit to `main`, and let Render redeploy. Keep all existing secrets unchanged.

Optional but recommended Render variable:

```text
CMC_MAX_CALLS_PER_MINUTE=9
```

After deploy, `/healthz` must show `0.3.2`. Then generate one CORE snapshot from `/snapshot`.
