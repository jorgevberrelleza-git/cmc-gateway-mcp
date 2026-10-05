# Upgrade to v0.6 — Adaptive Microstructure Engine v3

The v0.5 live snapshot produced high-quality book data but zero WebSocket trades in the fixed 18-second window. It also showed 100% matched cancellations with zero completions, which is informative but not strong enough to treat as direct trap evidence.

v0.6 therefore adds:

- adaptive capture: 18 s minimum, up to 45 s waiting for at least 3 live trades
- actual capture duration and stop reason
- REST trade freshness score and stale-flow down-weighting
- lifecycle `evidence_quality` and reduced cancellation weight when no live trades/completions appear
- persistent wall directional pressure (-100 to +100)
- execution gate support for persistent overhead supply combined with crowding
- same CMC budget and read-only architecture

Recommended Render additions:

```text
BITSO_CAPTURE_MAX_MS=45000
BITSO_MIN_LIVE_TRADES=3
```

Keep `BITSO_CAPTURE_MS=18000`. No Bitso API key is required.
