# Asesor Crypto — Inventario y auditoría de skills (2026-10-18)

Este inventario distingue agentes definidos en el plugin «Proyectos a construir», capacidades verificadas como módulos de código y skills instalables en GitHub. Una definición en GitHub **no** implica instalación automática en ChatGPT.

## I. Skills y agentes del plugin especializado (verificados mediante skills__list y sus referencias)
Existe 1 paquete de instrucciones de orquestación, con 6 prompts de agentes financieros:
1. **Orchestrator / Project Manager**: jerarquía y secuencia; mantiene restricciones y decisiones.
2. **Financial Data Mining & Intelligence**: limpieza y procedencia.
3. **Market Intelligence & Broker**: hipótesis de mercado; no ejecución.
4. **Quantitative Research & Backtesting**: pruebas fuera de muestra.
5. **Portfolio & Trading Risk Manager**: autoridad de bloqueo.
6. **Software Architect for AI Financial Systems**: arquitectura.
7. **Senior AI Software Engineer**: implementación y CI.

Nota: el orquestador es el controlador de los seis especialistas, no un séptimo especialista. Estas instrucciones de plugin son **de lectura** desde el conector actual; este repositorio no las sobrescribe.

## II. Skills propios en el repositorio
- `skills/shadow-geo-intelligence/SKILL.md` (v0.1): nuevo; lectura RSS oficial + seguimiento de eventos geopolíticos.
- No se detectó carpeta `skills/` previa a este cambio; las capacidades de Shadow actuales viven en código, no como paquetes de skill instalables.

## III. Capacidades/motores efectivamente implementados en el repositorio
| Motor | Ruta principal | Estado de auditoría |
| --- | --- | --- |
| CMC Gateway / Snapshot | `src/research.mjs`, `src/snapshot.mjs` | Mantener; revisar latencia/precios y documentación versión |
| Bitso microestructura | `src/microstructure.mjs`, `src/bitso-client.mjs` | Alta prioridad: gaps de secuencia / fuente de verdad |
| DefiLlama fundamentals | `src/defi-fundamentals.mjs` | Mantener aislamiento fallos + versiones API |
| Event detector / Quality filter | `src/learning/event-detector.mjs`, `event-quality-v02.mjs` | Añadir pruebas de causalidad/no look-ahead |
| Regime evidence & data consistency | `regime-evidence.mjs`, `data-consistency.mjs` | Integración GEO pendiente de backtest |
| Outcomes signed / Event study | `outcome-validation-v02.mjs`, `outcome-direction-v02.mjs` | Prioridad: costes, solapamiento y ventanas OOS |
| Shadow v0.2 posture | `shadow-v2.mjs` | Implementado como HOLD/filtro, no estrategias direccionales |
| Reasoner / Mock provider | `reasoning-provider.mjs` | Aún sin analista real y noticias verificadas automáticas |
| Decision validation / Risk sizing | `decision.mjs`, `sizing.mjs` | Independizar políticas de cualquier LLM |
| Paper ledger / Portfolio marks | `portfolio-ledger.mjs`, `benchmark.mjs` | Benchmark HODL y conciliación requeridos |
| Runtime, watchdog, reportes | `runtime-config.mjs`, `drift-watchdog.mjs`, `report.mjs` | Alarmas, SLO, costes y prueba de recuperación |
| GEO Intelligence | `geo-intelligence.mjs`, `learning-geo-scan.mjs` | Nuevo; verificar primera ejecución externa, no trading |

## IV. Barrido de actualizaciones recomendado (prioridad)
**P0**
- Data Mining: modificar referencia externa para definir esquema GEO versionado (URL oficial, fecha, frescura, fallos, cobertura), evitar instrucciones de fuentes externas y canal OFAC RSS retirado desde 2025-02-06.
- Market Agent: noticias oficiales = hipótesis, no impacto/correlación demostrada; exigir validación del documento y contraste con precio, volumen y liquidez.
- Quant: métricas fuera de muestra, agrupación por episodios para evitar pseudorreplicación, retornos netos y evaluación de valor incremental de GEO.
- Risk Manager: gate de cambio de exposición conservador y no sobreescribible por agentes; GEO v0.1 no concede entrada/salida ni inversión de dirección.
- CI: mantener regresión del bug SQL, pruebas de allowlist/prompt injection y verificación de feeds.

**P1**
- Architect: registro de fuentes y retención, cache, recuperación ante caídas, seguridad SSRF y validación de esquema.
- Developer: seguir cambios de Node.js, Actions, CMC/Bitso/DefiLlama; probar feeds y errores de proveedor sin activar órdenes.
- Fed, BCE: verificar URLs trimestralmente. SEC: evaluar RSS `/news/pressreleases.rss` y controles de acceso. BLS: integrar calendario ICS oficial para anticipar anuncios.

**P2**
- Descubrimiento de noticias secundarias (GDELT), sin convertir cobertura mediática en verdad o recomendaciones.
- Pruebas de red-team (titulares maliciosos, URLs externas, fechas manipuladas, duplicados).
- Integración GEO al análisis del régimen sólo tras demostrar que eleva calidad, no por importancia narrativa.

## V. Fuente y limitaciones del inventario
- Prompts de los agentes: plugin «Proyectos a construir», no editables desde este repositorio.
- Código: rama `feature/learning-engine-v0.1` del repositorio.
- Skills de Render y plantillas generales instaladas pertenecen al entorno del producto, **no son módulos de trading propios** ni requieren actualización directa en este repositorio.
- Lista de estado verificable, no garantía de eficacia operativa, capacidad de anticipar guerras o rentabilidad.

## VI. Política de promoción
Ninguna noticia o score GEO puede crear órdenes. Para integrar: cobertura estable > siete días, evaluación por episodios con muestra suficiente, no desviación del presupuesto, ensayo simulado. La autorización de Bitso y dinero real sigue siendo humana.

## VII. Actualizaciones confirmadas con documentación 2026
| Tecnología | Hallazgo verificado | Decisión |
| --- | --- | --- |
| Node 20 End of Life | Node.js 20 ya no recibe parches; la CI antes usaba 20 | Actualizado GitHub Actions a Node 22 y package engine >=22. Docker ya usa Node 22; Render cron usa Node 26. Próxima evaluación de Node 24 LTS con regresión completa. |
| GitHub Actions checkout | v7 incluye protecciones adicionales contra patrones peligrosos de pull_request_target | Actualizar de v4 a la versión probada en otro PR con matriz y permisos mínimos; el flujo actual usa push/pull_request, no pull_request_target. |
| Bitso Diff-Orders | Los huecos de secuencia obligan a re-sincronizar libro con REST + replay | Prioridad P0 antes de considerar señales fiables de paredes y book imbalance. |
| CMC Changelog septiembre 2026 | Publicó v5/cmc-ai/latest y cambios anteriores de coste por lote, simple price y liquidaciones | Evaluar cobertura y créditos del plan antes de habilitar llamadas nuevas. No tratar la IA de CMC como confirmación de hechos. |
| OFAC RSS | Retirado desde febrero 2025 | Mantener deshabilitado; evaluar fuentes oficiales alternativas. |
| SEC RSS | El emisor mantiene RSS de comunicados, pero pueden existir políticas técnicas de acceso | Pilotar con User-Agent apropiado y límites; no habilitar hasta confirmar accesibilidad. |

Fuentes oficiales: https://nodejs.org/en/about/eol , https://github.com/nodejs/Release ,
https://docs.bitso.com/bitso-api/docs/general ,
https://coinmarketcap.com/api/documentation/changelog ,
https://ofac.treasury.gov/recent-actions/20250206 ,
https://www.sec.gov/about/rss-feeds .
