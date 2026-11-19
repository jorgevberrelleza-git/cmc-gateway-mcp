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
