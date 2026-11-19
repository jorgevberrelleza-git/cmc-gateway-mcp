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
