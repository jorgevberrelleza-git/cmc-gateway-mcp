# Shadow — Preparación para producción (controles de un broker autónomo)

Referencia: controles de trading algorítmico tipo MiFID II RTS 6 (art. 12 *kill functionality*, art. 15 controles pre-trade) y SEC 15c3-5, adaptados a una cuenta personal en Bitso. Actualizado: 21-nov-2026.

| Control | Qué exige la práctica | Estado en Shadow | Dónde |
|---|---|---|---|
| Banda de precio (*price collar*) | Bloquear órdenes con precio fuera de rango | ✅ v0.8.1: el mid de Bitso no puede desviarse más de 2% del precio de referencia de Kraken | `executor-v08.mjs` |
| Valor máximo por orden | Bloquear órdenes de valor inusual | ✅ v0.8.1: máximo 2,500 USD; el resto se ejecuta la hora siguiente | idem |
| Volumen máximo / impacto | Tamaño acorde a la liquidez | ✅ v0.8.1: máximo 50% de la profundidad visible dentro del 0.5% del precio | idem |
| Límite de mensajes y freno de ejecución | Desactivar tras N ejecuciones repetidas hasta reactivación humana | ✅ máximo 6 órdenes/día; más de 8 ejecuciones en 7 días deja un HALT enclavado | idem |
| Capital / crédito | Límites de capital por cuenta | ✅ mandato < 50% del portafolio; stop de −20% enclavado; nunca vende monedas fuera del mandato | idem |
| *Kill functionality* | Cancelar todo de inmediato | ✅ en ensayo: no hay código de órdenes; `SHADOW_EXECUTION_ENABLED` rechazado; llave de solo lectura. ⏳ Live: cancelar órdenes abiertas al activar el kill | fase B |
| Fallo cerrado | No operar con datos dudosos | ✅ posturas viejas, sin saldos, spread anormal, sin profundidad, sin referencia → HOLD | idem |
| Idempotencia | Sin órdenes duplicadas | ✅ IDs derivados de la decisión; un registro por snapshot bajo lock | runner |
| Conciliación post-trade | Comparar los registros propios con los del venue | ✅ en ensayo: las unidades del mandato deben existir en la cuenta. ⏳ Live: conciliar fills con `user_trades` | fase B |
| Separación de llaves | Mínimo privilegio | ✅ hoy solo lectura; en live: operar **sin retiro**, restringida por IP | Bitso |
| Monitoreo en tiempo real | Supervisión y alertas | ✅ `SHADOW_DECISION_SUMMARY` cada hora; revisión diaria (incluye noticias, movimientos extremos y gasto de Render) | tarea diaria |
| Pruebas antes de desplegar | Tests, incluso en estrés | ✅ selftests por módulo + CI en cada PR; ⏳ simulacros de falla en la fase B | CI |
| Control de cambios | Aprobación para desplegar | ✅ todo cambio entra por PR y la propietaria aprueba el merge | GitHub |
| Continuidad del negocio | Respaldo y recuperación | ⏳ dump cifrado de Postgres y prueba de restauración | fase B |
| Presupuesto | No exceder el gasto | ✅ tope de **15 USD/mes** en Render; la revisión diaria alerta al 80% (12 USD) del proyectado | tarea diaria |

## Pendiente para el go-live (fase B, antes del 31-ene-2027)
1. ✅ (PR #36, 21-nov) Cliente de órdenes **separado**, bloqueado y sin conectar: candado revisado en cada orden, límite IOC con banda de precio, libros `btc_usd`/`ada_usd`, topes de 5 a 2,500 USD, diario atómico antes del POST, UNKNOWN bloquea, sin retiros. Dos auditorías independientes. ⏳ Al conectarlo: diario en Postgres con UNIQUE, lock de un proceso, traducción planner→IOC.
2. ✅ Kill: `cancelShadowOrders` cancela solo las órdenes de Shadow por `origin_id`; el candado bloquea las nuevas al desactivar.
3. Conciliación de fills reales contra `user_trades` y saldos tras cada orden.
4. Simulacros: Bitso caído, precio corrupto, doble corrida, Postgres caído, stop disparado, llave revocada.
5. Respaldo cifrado de Postgres y prueba de restauración.
