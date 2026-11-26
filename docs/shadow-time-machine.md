# Shadow Time Machine — MVP v0.1

**Estado:** simulador histórico aislado y offline. No hay integración con Bitso para ejecutar órdenes, aprendizaje automático ni entrenamiento de estrategia validado. Vinculado al issue #14.

## Capacidades implementadas
- Reproduce un reloj virtual sobre velas OHLCV de BTCUSDT, ADAUSDT y AAVEUSDT.
- La decisión se forma únicamente con barras CERRADAS y se llena al abrir la siguiente. No hay lookahead en la ruta normal de ejecución.
- Ejecuta un ejemplo de política SMA 7/30 frente a HOLD y efectivo, descontando comisiones y deslizamiento; calcula rendimiento, drawdown y bitácora.
- Detecta velas faltantes, duplicados, OHLC imposibles, cambio de ms a µs en 2025, cobertura simultánea y checksums SHA256.
- Reproduce 1826 días SINTÉTICOS a velocidad máxima, sin reloj artificial ni API.
- Importa CSV descargados con checksum oficial desde Binance Vision (la descarga es un proceso separado y opt-in).

## Requisitos
Node.js 22+. Python 3 estándar únicamente para descarga opcional de históricos. Sin claves Bitso, Groq, CMC, ni BD de Render.

## Ejecución
1. Pruebas completamente offline:
   node scripts/learning-time-machine-selftest.mjs
2. Demostración sintética (NO DATOS DE MERCADO):
   node scripts/learning-time-machine.mjs --demo --output=synthetic-5y.json
3. Descargar datos públicos reales verificados, meses completos:
   python3 scripts/learning-time-machine-fetch.py --start=2021-01 --end=2026-10 --interval=1d
4. Reproducir datos reales:
   node scripts/learning-time-machine.mjs --manifest=manifest.json --root=data/time-machine --output=historical-report.json
5. Alternativa de política únicamente experimental:
   node scripts/learning-time-machine.mjs --demo --fast=14 --slow=60 --output=other.json

Los reportes se guardan en artifacts/time-machine/. Los datos descargados en data/time-machine/ NO se deben subir a GitHub. El workflow GitHub Actions shadow-time-machine.yml ejecuta las pruebas, un demo sintético de 5 años y un smoke test histórico verificable de 3 meses. Su entrada manual full_history habilita 2021-01..2026-10, sin credenciales.

## Restricciones
- Precios de Binance en USDT no equivalen a precios ejecutables de Bitso en USDC o MXN. Se requiere validación específica de exchange y FX.
- SMA 7/30 es un ejemplo fijo, NO entrenado. Repetir el período muchas veces NO crea pruebas independientes.
- Sin noticias macro, libro histórico ni datos de IPO en MVP. Los días con gaps internos son rechazados; el período común de los tres activos se usa para el motor.
- Sin modificaciones en el motor principal de Shadow, registros de cartera productiva, servicios ni credenciales. Sin costos nuevos de proveedores; GitHub Actions podría consumir minutos del plan de GitHub.

## Próximos módulos
v0.2: train 2021–2024, validate 2025, holdout sellado 2026 y walk-forward purgado con reglas estrictas para evitar fuga temporal.
v0.3: estudio de eventos SpaceX y Anthropic con mercado de acciones por sesión y verificación de fechas de publicación.
v0.4: adaptador de observación al razonador Shadow, políticas candidatas, metaevaluador Claude/Groq opcional sobre RESÚMENES agregados, no cada día.
v0.5: pruebas de estrés de liquidez, fallas operativas y validación prospectiva mock.
Promoción a inversión real siempre queda bloqueada hasta pruebas independientes y aprobación humana.


## Phase v0.2 — chronological walk-forward rule selection

Three expanding historical folds evaluate a PREDECLARED grid of eight SMA fast/slow variants. No generative AI or autonomous policy rewriting takes place.

| Fold | Training available to researcher | Validation (7-day embargo at boundary) |
|---|---|---|
| 1 | 2021–2022 | 2023-01-08 through 2023-12-31 |
| 2 | 2021–2023 | 2024-01-08 through 2024-12-31 |
| 3 | 2021–2024 | 2025-01-08 through 2025-12-31 |

The best research candidate is chosen deterministically using validation years only: number of independent folds with positive alpha vs HOLD, then mean net alpha, drawdown relief, and lower trade count. All outcomes deduct 10 bps assumed fees and 5 bps slippage. Additional stress checks use 30 bps fees and 20 bps slippage. Failure to meet the predeclared gate marks the policy **RESEARCH_ONLY / VALIDATION_GATE_FAILED**; no policy is ever promoted.

2026 is evaluated only **after** the prior selection is written to an immutable-hash-checked lock file. Its window is 2026-01-08 through 2026-10-31. Important: the 2026 market has already been viewed during earlier Time Machine experiments, so this retrospective test IS NOT a truly blind out-of-sample demonstration; only future, never-inspected prospective data can provide stronger independent evidence.

Commands, with the same verified Binance local manifest:

1. node scripts/learning-time-machine-walkforward.mjs --manifest=manifest.json --root=data/time-machine --stage=select
2. node scripts/learning-time-machine-walkforward.mjs --manifest=manifest.json --root=data/time-machine --stage=test
3. node scripts/learning-time-machine-walkforward-selftest.mjs

The first command produces artifacts/time-machine/walkforward-policy-lock.json. The second refuses changed historical pretest data or tampered lock and produces artifacts/time-machine/walkforward-retrospective-2026.json. CI runs the two-stage process on a synthetic fixture and full verified historical data.

The model has selected among fixed rules; this is **hyperparameter optimization**, not machine learning weights, reinforcement learning, adaptive online learning, or proof of net investment advantage. The simulator remains completely disconnected from the hourly production path, Bitso credentials, external APIs, real money, and any self-modifying policy deployment.


## Phase v0.3 — market regimes + IPO retrospective research (offline)

The NEW module is not enabled by Shadow hourly cron or Bitso. It uses a separate research-only CLI, no API keys, no database access, no capital movement, no paid model calls.

### Classification (on CLOSED bars only)
BTC daily history up to observation time exclusively provides leading context for BTC/ADA/AAVE:
- UNKNOWN: insufficient 90-200 closed BTC daily bars -> HOLD, not bullish by default.
- SHOCK: severe 10-day decline, or high realized volatility with negative 10-day returns -> defensive exit simulated.
- BEAR: BTC below slow moving-average trend or severely negative 30-day return -> simulated exit.
- BULL: BTC above slow trend, fast above slow, momentum positive, volatility below shock threshold -> check asset-specific momentum before buying.
- SIDEWAYS: mixed conditions -> no new entries; trim only weakening existing positions.

Four predetermined regime parameter sets compete with two SMA reference policies. Risk-on is never inferred from an IPO announcement. No self-trained neural network, Claude API, or on-line strategy promotion is operating.

### Chronological evaluation
Each 2023/2024/2025 fold picks a candidate on PREVIOUS training history, then evaluates it on next untouched validation period (embargo seven days). The final 2026 candidate is locked from pre-2026 validation scores only, verified with checksum and rejected on changed pretest data. An event study of SpaceX is calculated separately and is not injected as a training feature. 2026 results remain retrospective — 2026 was already inspected in earlier v0.1/v0.2 experiments.

Research gate: at least 2 of 3 positive validation years vs fixed HOLD, positive mean net alpha, nonnegative stressed alpha, worst validation maximum drawdown no worse than 40%; failure means reject, not automatic retraining or promotion.

### SpaceX IPO event
- Issuer/SEC confirms stock listed June 12 2026, SPCX: https://ir.spacex.com/updates/releases-details/2026/Space-Exploration-Technologies-Corp--Announces-Closing-of-Initial-Public-Offering-Including-Full-Exercise-of-Underwriters-Option-to-Purchase-Additional-Shares-2026-RgoR-Y1Vwh/
- Nasdaq newsroom quotes first print at $150 around 10:15 a.m. ET: https://www.nasdaq.com/newsroom/spacex-ipo-rocket-company-launches-historic-ipo
- Backtest computes BTC, ADA, AAVE post-event 1/3/7/30 UTC-day closes, compared with 8-20 spaced, pre-event-matched historical control windows, conditional on BTC 30d trend and 20d volatility.
- **Noncausal**: no proof IPO caused crypto returns, no equity share simulation, no simulated Nvierto entry.
- Anthropic Nov 19 2026 is recorded as INSUFFICIENT_OBSERVED_OUTCOMES in dataset ending Oct 31. Do not fabricate future returns. Official pricing: https://www.anthropic.com/news/anthropic-prices-initial-public-offering

### Commands
Run from a repository checkout with verified local Binance history:
1. node scripts/learning-regime-lab.mjs --manifest=manifest.json --root=data/time-machine --stage=select
2. node scripts/learning-regime-lab.mjs --manifest=manifest.json --root=data/time-machine --stage=test
3. node scripts/learning-regime-lab.mjs --manifest=manifest.json --root=data/time-machine --stage=event --event=SPACEX_IPO_20260612
4. npm run learning:regime:selftest

Workflow: .github/workflows/shadow-regime-events-v03.yml; artifacts are under artifacts/time-machine. No additional Render instance is required. Priorities after v0.3: confirm real Bitso tradeable venue/spreads; prospective new market data; independent news timestamp feed and more matched events; produce a bounded offline error-review packet for optional AI critique (not per candle).
