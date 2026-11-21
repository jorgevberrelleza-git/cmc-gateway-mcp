# Shadow trend filter v0.7.1 — evidencia y especificación (RESEARCH / PAPER ONLY)

## Especificación congelada
- Universo: **BTC y ETH** (otros activos → `ABSTAIN: asset_outside_universe`).
- `RISK_ON` si el último cierre diario UTC **ya cerrado** es mayor que su SMA de 200 días; `RISK_OFF` en otro caso.
- `ABSTAIN` sin lanzar excepción ante: menos de 200 días, huecos, duplicados, precios inválidos, o datos con más de 36 h. Un `ABSTAIN` **conserva el peso previo** (una falla de datos nunca fuerza una liquidación) y nunca abre posición.
- Tamaño paper: 7.5% por activo, 15% en total. Se eligió para que el drawdown histórico de la estrategia (~40% a exposición completa) quede dentro de los límites del broker v0.6 (DD 10%, pérdida diaria 2%).
- `tradeable=false` y `realOrdersAllowed=false` siempre. Cambiar cualquier parámetro exige una versión nueva y reinicia la ventana prospectiva.

Módulo `src/learning/trend-filter-v07.mjs` · prueba `npm run learning:trend:v07:selftest`.

## Reproducibilidad
```bash
node scripts/learning-audit-fetch-binance-daily.mjs --out=daily.json   # red no-EE.UU.; imprime sha256
node scripts/learning-v04-historical-audit.mjs --input=daily.json > audit.json
```
- Entrada: velas diarias Binance (USDT) 2020-12-01 → 2026-11-19, 2,180 días × 6 activos. `inputSha256 = d3a9f12907eb3c0384ce7a99df3979a12341f508b4e5454480143eff3361974d`.
- Código: `src/learning/historical-audit-v07.mjs`, sha256 del fuente `2e4bf4aa204a12f2cbf99d42c3e0aac8813af59df2665ece84507c07afc012b7` (el mismo código, byte a byte, se ejecutó el 20-nov-2026).
- Salida: JSON compacto con sha256 `b1bacafc2bec134b82bb6e5c805f6658cc78ca84af6da40552830f1956638a0f`. Las tablas de abajo se transcriben de esa salida.

## A. ¿Tiene habilidad direccional el voto de momentum de v0.4?

**Qué se probó y qué no:** la v0.4 en vivo suma un voto de microestructura que no existe en el histórico, y en vivo hace ABSTAIN si falta. Aquí ese voto vale 0, así que esto es una **aproximación "solo momentum"**, no la v0.4 exacta. El acierto se mide con las **bandas neutrales del código en vivo** (1.5% / 2.5% / 4%): un movimiento dentro de la banda es FLAT y cuenta como fallo para un UP o un DOWN. La hipótesis nula es la **mejor constante** (siempre UP o siempre DOWN) en los mismos días, no el 50%. El error estándar y la z están ajustados por solapamiento (n/h).

| Activo | h | n | Acierto ± EE | Siempre UP | Siempre DOWN | z vs mejor constante |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 1d | 370 | 27.6 ± 2.3 | 31.1 | 25.1 | −1.46 |
| BTC | 3d | 369 | 30.6 ± 4.2 | 37.7 | 26.8 | −1.61 |
| BTC | 7d | 1,064 | 25.4 ± 3.5 | 27.3 | 24.6 | −0.55 |
| ETH | 1d | 550 | 32.0 ± 2.0 | 36.9 | 29.3 | −2.39 |
| ETH | 3d | 549 | 33.9 ± 3.5 | 39.0 | 29.9 | −1.41 |
| ETH | 7d | 1,308 | 32.1 ± 3.4 | 33.4 | 28.5 | −0.38 |
| ADA | 1d | 645 | 34.9 ± 1.9 | 38.9 | 31.9 | −2.10 |
| ADA | 3d | 644 | 37.3 ± 3.3 | 37.3 | 34.6 | 0.00 |
| ADA | 7d | 1,454 | 33.5 ± 3.3 | 30.6 | 37.3 | −1.13 |
| AAVE | 1d | 746 | 35.9 ± 1.8 | 37.8 | 38.9 | −1.65 |
| AAVE | 3d | 745 | 35.4 ± 3.0 | 36.1 | 38.1 | −0.87 |
| AAVE | 7d | 1,599 | 35.0 ± 3.2 | 38.0 | 36.6 | −0.93 |
| LINK | 1d | 683 | 32.8 ± 1.8 | 37.8 | 35.3 | −2.68 |
| LINK | 3d | 682 | 34.6 ± 3.2 | 37.1 | 33.7 | −0.78 |
| LINK | 7d | 1,529 | 34.5 ± 3.2 | 35.5 | 35.9 | −0.44 |
| XRP | 1d | 530 | 32.8 ± 2.0 | 38.5 | 30.2 | −2.68 |
| XRP | 3d | 530 | 30.2 ± 3.5 | 36.2 | 33.0 | −1.67 |
| XRP | 7d | 1,302 | 28.7 ± 3.3 | 30.3 | 32.0 | −0.97 |

**Lectura:** en las 18 combinaciones el acierto queda **por debajo o igual** a la mejor constante. No hay **evidencia** de habilidad. No se puede descartar una habilidad pequeña con estas n, y la "reversión" a 1d (z hasta −2.7) no es concluyente después de corregir por 18 pruebas (umbral Bonferroni ≈ 2.9). La microestructura podría cambiar el resultado, pero solo hay ~6 semanas de ese dato.

## B. El voto de momentum como regla de salida (vender con DOWN, volver con UP) vs HOLD, 2021-01-01 → 2026-11-19

| Activo | h | Costo/lado | Retorno | HOLD | Max DD | DD HOLD | Operaciones |
|---|---:|---:|---:|---:|---:|---:|---:|
| BTC | 1d | 0.42% | −20.1% | +111.3% | −74.4% | −76.6% | 110 |
| BTC | 7d | 0.42% | +45.6% | +111.3% | −63.4% | −76.6% | 143 |
| BTC | 7d | 0.80% | −15.7% | +111.3% | −70.8% | −76.6% | 143 |
| ETH | 7d | 0.42% | +73.3% | +141.1% | −73.9% | −79.3% | 169 |
| ADA | 7d | 0.42% | +1.6% | −13.2% | −90.6% | −95.2% | 189 |
| AAVE | 1d | 0.42% | +68.1% | +15.5% | −80.7% | −92.1% | 167 |
| AAVE | 1d | 0.80% | −11.2% | +15.5% | −89.4% | −92.1% | 167 |
| LINK | 7d | 0.42% | −36.9% | −24.0% | −83.2% | −90.2% | 188 |
| XRP | 7d | 0.42% | +230.0% | +304.4% | −73.0% | −83.2% | 180 |

**Lectura:** hace de 18 a 34 operaciones al año. Con 0.80% por lado pierde contra HOLD en los seis activos. No es candidata.

## C. Regla declarada de antemano: invertido solo si cierre > SMA200 (2021-06-18 → 2026-11-19)

| Activo | Costo/lado | Retorno | HOLD | Max DD | DD HOLD | Operaciones | % invertido |
|---|---:|---:|---:|---:|---:|---:|---:|
| **BTC** | 0.42% | +74.5% | +73.1% | **−37.4%** | −76.6% | 50 | 53% |
| **BTC** | 0.80% | +44.1% | +73.1% | −39.7% | −76.6% | 50 | 53% |
| **ETH** | 0.42% | +111.2% | −21.3% | **−43.5%** | −79.3% | 33 | 49% |
| **ETH** | 0.80% | +86.2% | −21.3% | −45.4% | −79.3% | 33 | 49% |
| ADA | 0.42% | −66.0% | −89.3% | −85.7% | −95.2% | 53 | 34% |
| AAVE | 0.42% | −73.0% | −60.5% | −77.3% | −88.4% | 78 | 39% |
| LINK | 0.42% | −83.1% | −57.6% | **−87.4%** | −85.3% | 80 | 36% |
| XRP | 0.42% | −58.8% | +20.5% | **−87.0%** | −77.9% | 85 | 47% |

Por año en BTC (política / HOLD): 2022 0% / −65%; 2023 +91% / +155%; 2024 +68% / +112%; 2025 −22% / −7%; 2026 +2% / −30%.

**Lectura honesta:**
- **BTC y ETH:** el drawdown baja a la mitad y el resultado se sostiene con costos de 0.80%. En BTC el retorno empata con HOLD a 0.42% y queda por debajo a 0.80%; en ETH queda por encima.
- **ADA y AAVE:** el drawdown baja, pero el retorno es malo; el filtro limita el daño sin rescatar activos en declive.
- **LINK y XRP: fracasa.** Drawdown peor que HOLD y retorno mucho peor, por los cruces falsos en activos muy volátiles.
- En conjunto: **2 de 6 activos claramente a favor**. Es una sola trayectoria histórica dominada por los bears de 2022 y 2026, sobre una regla clásica y conocida. Restringir el universo a BTC/ETH después de ver estos resultados es en sí una selección ex post, y por eso la validación prospectiva es obligatoria.
- Supuestos que la sesgan: decisión y ejecución al mismo cierre (sin latencia); drawdown medido solo en cierres; efectivo con 0% de rendimiento (subestima el filtro, que pasa ~50% del tiempo fuera); precios Binance USDT ≠ Bitso USD; no incluye riesgo USDT/USD ni MXN.
