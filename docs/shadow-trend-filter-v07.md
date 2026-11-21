# Shadow trend filter v0.7 — evidencia y especificación (RESEARCH / PAPER ONLY)

**Especificación congelada:** por activo, `RISK_ON` si el último cierre diario UTC ya cerrado es mayor que su SMA de 200 días; `RISK_OFF` en otro caso; `ABSTAIN` con menos de 200 días, con huecos o con datos de más de 36 h. Pesos paper: reparto igual de la exposición máxima del broker v0.6 (≤20% por activo, ≤60% total). Módulo: `src/learning/trend-filter-v07.mjs`; prueba: `npm run learning:trend:v07:selftest`; auditoría reproducible: `npm run learning:audit:v04:historical -- --input=daily.json`.

**No autoriza órdenes reales.** Cambiar cualquier parámetro exige versión nueva y reinicia la ventana prospectiva.

Aviso: en datos sintéticos de camino aleatorio, el script puede mostrar aciertos de ~56% con z≈1.9. Un solo resultado "significativo" no prueba nada; por eso la regla se declaró antes de verse y no se optimizó.

## Backtest independiente — 20-nov-2026

Datos: velas diarias públicas de Binance (USDT), 2020-12-01 a 2026-11-19, 2,180 días por activo. Decisión con el cierre del día t y posición desde t+1 (sin lookahead). Costos por lado: 0.42% (taker de Bitso 0.36% + medio spread) y escenario de estrés de 0.80%. No es precio ejecutable en Bitso; son una aproximación.

## A. Habilidad direccional del modelo congelado v0.4 (sólo momentum; la microestructura no existe en el histórico)

Evaluación desde 2021-01-01. "Acierto" = la dirección pronosticada coincide con el cierre a h días.

| Activo | h | Emitidos | Cobertura | Acierto | Siempre UP | z vs 50% |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 1d | 370 | 17% | 44.3% | 50.8% | −2.18 |
| BTC | 3d | 369 | 17% | 43.9% | 58.3% | −1.35* |
| BTC | 7d | 1,064 | 50% | 48.9% | 51.1% | −0.28* |
| ADA | 1d | 645 | 30% | 47.8% | 53.2% | −1.14 |
| ADA | 3d | 644 | 30% | 50.8% | 53.0% | 0.23* |
| ADA | 7d | 1,454 | 68% | 49.3% | 45.7% | −0.20* |
| ETH | 1d | 550 | 26% | 47.1% | 54.2% | −1.36 |
| ETH | 7d | 1,308 | 61% | 50.5% | 52.4% | 0.13* |
| LINK | 1d | 683 | 32% | 46.1% | 52.3% | −2.03 |
| XRP | 1d | 530 | 25% | 47.4% | 55.1% | −1.22 |
| XRP | 7d | 1,302 | 61% | 46.2% | 47.9% | −1.05* |

\* z ajustado por solapamiento de ventanas (n/h).

**Conclusión:** sin habilidad direccional en ningún activo ni horizonte. A 24h el momentum tiende a revertir (acierto < 50%). Esto es coherente con el 1/1 en vivo: ese acierto era indistinguible del azar y del benchmark "siempre DOWN".

## B. v0.4 usado como política defensiva (vender con DOWN, volver con UP) vs HOLD, 2021-01-01 → 2026-11-19

| Activo | Horizonte | Costo/lado | Retorno | HOLD | Max DD | DD HOLD | Operaciones |
|---|---|---:|---:|---:|---:|---:|---:|
| BTC | 24h | 0.42% | −12.0% | +111.3% | −74.4% | −76.6% | 109 |
| BTC | 7d | 0.42% | +45.6% | +111.3% | −63.2% | −76.6% | 143 |
| BTC | 7d | 0.80% | −15.7% | +111.3% | −70.8% | −76.6% | 143 |
| ADA | 24h | 0.42% | +15.3% | −13.2% | −90.0% | −95.2% | 145 |
| ADA | 7d | 0.42% | +1.6% | −13.2% | −90.6% | −95.2% | 189 |
| ETH | 24h | 0.42% | +22.2% | +141.1% | −80.2% | −79.3% | 137 |
| ETH | 7d | 0.42% | +73.3% | +141.1% | −73.8% | −79.3% | 169 |

**Conclusión:** demasiadas operaciones (20–30/año) y alivio de drawdown pequeño. Con costo de 0.80% destruye valor. No pasa ningún criterio razonable de GO.

## C. Regla de referencia declarada antes de verla (una sola prueba): invertido sólo si el cierre > media de 200 días

Periodo 2021-07-20 → 2026-11-19 (se necesitan 200 días previos).

| Activo | Costo/lado | Retorno | HOLD | Max DD | DD HOLD | Operaciones | % tiempo invertido |
|---|---:|---:|---:|---:|---:|---:|---:|
| BTC | 0.42% | +74.5% | +108.1% | **−37.2%** | −76.6% | 50 | 54% |
| BTC | 0.80% | +44.1% | +108.1% | −39.2% | −76.6% | 50 | 54% |
| ETH | 0.42% | **+170.0%** | −1.6% | **−43.5%** | −79.3% | 30 | 49% |
| ETH | 0.80% | +140.7% | −1.6% | −45.4% | −79.3% | 30 | 49% |
| ADA | 0.42% | −56.9% | −85.6% | −85.7% | −95.2% | 52 | 33% |
| ADA | 0.80% | −64.7% | −85.6% | −87.0% | −95.2% | 52 | 33% |

Por año (política / HOLD), BTC: 2022 0% / −65%; 2023 +91% / +155%; 2024 +68% / +112%; 2025 −22% / −7%; 2026 +2% / −30%.

**Lectura honesta:**
- La regla cumple el objetivo "perder menos que HOLD": baja el drawdown a la mitad en los tres activos y es robusta a costos de 0.80%.
- No "gana más" de forma consistente: en BTC cede retorno en mercados alcistas (2023–2024) y pierde en mercados laterales (2025).
- Es una regla de trend-following ampliamente conocida, no un descubrimiento; es una sola muestra histórica dominada por el bear de 2022 y el de 2026.
- ADA sigue cayendo −57% aun con el filtro: el filtro limita el daño, no rescata un activo en declive estructural.
- Precios Binance USDT ≠ Bitso USD; hay que reconciliar con el histórico de Bitso antes de cualquier decisión.
