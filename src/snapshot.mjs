import crypto from 'node:crypto';
import { buildTradingSnapshot } from './research.mjs';

const LOGIN_SECRET = process.env.OAUTH_LOGIN_SECRET || '';
const MAX_PER_10_MIN = Math.max(1, Number(process.env.SNAPSHOT_MAX_REQUESTS_PER_10_MIN || 6));
const requestLog = new Map();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function allowSnapshot(ip) {
  const now = Date.now();
  const windowMs = 10 * 60_000;
  const arr = (requestLog.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= MAX_PER_10_MIN) {
    requestLog.set(ip, arr);
    return false;
  }
  arr.push(now);
  requestLog.set(ip, arr);
  return true;
}

async function readBody(req, maxBytes = 65536) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    pragma: 'no-cache',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function page(res) {
  const html = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Trading Snapshot Console</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#15171a;--muted:#667085;--line:#d0d5dd;--accent:#111827;--soft:#f2f4f7;--ok:#067647;--err:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#15181d;--text:#f4f4f5;--muted:#a1a1aa;--line:#343a40;--accent:#f4f4f5;--soft:#20242a;--ok:#6ce9a6;--err:#fda29b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1050px;margin:0 auto;padding:28px}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;box-shadow:0 8px 28px rgba(0,0,0,.06)}h1{margin:0 0 6px;font-size:25px}p{margin:6px 0 18px;color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 140px;gap:14px}.full{grid-column:1/-1}label{display:block;font-weight:650;margin-bottom:6px}input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font:inherit}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 10px}button{padding:11px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);font-weight:700;cursor:pointer}button.primary{background:var(--accent);color:var(--bg);border-color:var(--accent)}button:disabled{opacity:.55;cursor:wait}.status{min-height:24px;margin:8px 0;font-weight:650}.ok{color:var(--ok)}.err{color:var(--err)}textarea{width:100%;min-height:430px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--text);font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}.note{font-size:13px;color:var(--muted);margin-top:12px}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:var(--soft);font-size:12px;margin-right:6px}@media(max-width:700px){.grid{grid-template-columns:1fr}.wrap{padding:14px}.card{padding:17px}}
</style>
</head>
<body><main class="wrap"><section class="card">
<h1>Trading Snapshot Console <span class="pill">v0.6.1</span></h1>
<p>Snapshot CORE de CoinMarketCap + Microstructure Engine v3 de Bitso + Fundamental DeFi Sidecar v1 de DefiLlama: captura adaptativa de trades, persistencia de paredes, presión de oferta/demanda persistente, ciclos open→cancel/complete emparejados, freshness de trades REST, barridos/rechazos heurísticos, crowding, confirmación spot y confianza de datos. DefiLlama añade TVL, fees, revenue y contexto de liquidez stablecoin para AAVE; sólo confirma/degrada la tesis y nunca genera una compra por sí solo. Es solo lectura; no ejecuta órdenes.</p>
<div class="grid">
<div><label for="assets">Activos</label><input id="assets" value="BTC,AAVE,ADA" maxlength="40"></div>
<div><label>Modo</label><input value="CORE + MICRO" readonly></div>
<div><label for="capture">Captura mínima Bitso (seg)</label><input id="capture" type="number" min="6" max="30" value="18"></div>
<div><label>Microestructura</label><input value="Bitso público · microstructure v3" readonly></div>
<div><label>Fundamentales DeFi</label><input value="DefiLlama free · cache 6 h" readonly></div>
<div class="full"><label for="secret">Gateway login secret</label><input id="secret" type="password" autocomplete="current-password" placeholder="El mismo OAUTH_LOGIN_SECRET de Render"></div>
</div>
<div class="actions">
<button id="generate" class="primary">Generar Trading Snapshot</button>
<button id="copy" disabled>Copiar JSON</button>
<button id="copyPrompt" disabled>Copiar para ChatGPT</button>
<button id="clear">Limpiar</button>
</div>
<div id="status" class="status"></div>
<textarea id="output" readonly spellcheck="false" placeholder="Aquí aparecerá el snapshot..."></textarea>
<div class="note">Protección: máximo ${MAX_PER_10_MIN} snapshots cada 10 minutos por IP. CMC usa como máximo 9 herramientas para BTC/AAVE/ADA. Bitso y DefiLlama usan endpoints públicos; DefiLlama queda cacheado por 6 h por defecto y no requiere API key. Recomendación: mínimo 18 s. v0.6.1 puede extender automáticamente la captura hasta 45 s si no aparecen suficientes trades en vivo. La cancelación sólo se puntúa con ciclos OPEN→CANCELLED/COMPLETED emparejados y se reduce su peso cuando no hay fills/trades en vivo. Las paredes persistentes se tratan como oferta/soporte, no como prueba de manipulación.</div>
</section></main>
<script>
const $=id=>document.getElementById(id);let snapshot=null;
function setStatus(text,kind=''){const el=$('status');el.textContent=text;el.className='status '+kind}
function parseAssets(){return $('assets').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean)}
$('generate').onclick=async()=>{
 const secret=$('secret').value.trim(); if(!secret){setStatus('Escribe tu Gateway login secret.','err');return}
 const assets=parseAssets(); if(!assets.length||assets.length>3){setStatus('Usa entre 1 y 3 activos.','err');return}
 const captureSeconds=Math.max(6,Math.min(30,Number($('capture').value)||18));
 $('generate').disabled=true;$('copy').disabled=true;$('copyPrompt').disabled=true;snapshot=null;$('output').value='';
 setStatus('Consultando CMC y capturando Bitso durante '+captureSeconds+' s… espera a que termine la ventana completa.');
 try{
  const r=await fetch('/api/snapshot',{method:'POST',headers:{'content-type':'application/json','x-gateway-secret':secret},body:JSON.stringify({assets,include_microstructure:true,capture_seconds:captureSeconds})});
  const data=await r.json(); if(!r.ok) throw new Error(data.error_description||data.error||('HTTP '+r.status));
  snapshot=data; $('output').value=JSON.stringify(data,null,2); $('copy').disabled=false;$('copyPrompt').disabled=false;
  setStatus('Snapshot generado. Ya puedes copiarlo a ChatGPT.','ok');
 }catch(e){setStatus('Error: '+e.message,'err')}
 finally{$('generate').disabled=false}
};
$('copy').onclick=async()=>{if(!snapshot)return;await navigator.clipboard.writeText(JSON.stringify(snapshot,null,2));setStatus('JSON copiado.','ok')};
$('copyPrompt').onclick=async()=>{if(!snapshot)return;const prompt='Analiza este Trading Snapshot v0.6.1 con nuestro Trading Engine actual. Integra estructura técnica, volumen, derivados, sentimiento, macro, catalizadores, relative_strength, concentración, No-Chase, reward/risk, microestructura de Bitso y defi_fundamentals de DefiLlama. Evalúa explícitamente trap_risk, crowding_risk, spot_confirmation, microstructure_confidence, adaptive_capture, rest_trade_freshness, matched_lifecycle evidence_quality, wall_persistence, persistent_wall_pressure, mid_path sweep/rejection, venue_price_check y, para AAVE, TVL/fees/revenue/stablecoin_liquidity_context/fundamental_quality. No afirmes spoofing/manipulación/stop-hunting como hecho. Los fundamentales DeFi sólo pueden confirmar, degradar o vetar una tesis; nunca crear COMPRAR por sí solos. Da menos peso a señales con baja confianza y no infieras métricas faltantes. Valida noticias materiales con fuentes primarias antes de cambiar una posición. Dime para cada activo MANTENER, COMPRAR, REDUCIR, VENDER o MOVER A USD y registra la decisión para aprendizaje.\n\nTRADING SNAPSHOT V0.6.1:\n'+JSON.stringify(snapshot,null,2);await navigator.clipboard.writeText(prompt);setStatus('Prompt + snapshot copiados. Pégalos en nuestro chat.','ok')};
$('clear').onclick=()=>{snapshot=null;$('output').value='';$('copy').disabled=true;$('copyPrompt').disabled=true;setStatus('')};
</script></body></html>`;

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  });
  res.end(html);
}

export async function handleSnapshotHttp(req, res, url) {
  if (req.method === 'GET' && (url.pathname === '/snapshot' || url.pathname === '/snapshot/')) {
    page(res);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/snapshot') {
    const supplied = String(req.headers['x-gateway-secret'] || '');
    if (!LOGIN_SECRET || !safeEqual(supplied, LOGIN_SECRET)) {
      json(res, 401, { error: 'unauthorized', error_description: 'Invalid gateway login secret' });
      return true;
    }

    const ip = clientIp(req);
    if (!allowSnapshot(ip)) {
      json(res, 429, { error: 'rate_limited', error_description: `Maximum ${MAX_PER_10_MIN} snapshots per 10 minutes` });
      return true;
    }

    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = await buildTradingSnapshot({
        assets: body.assets,
        includeMicrostructure: body.include_microstructure !== false,
        captureMs: Math.max(6000, Math.min(30000, Number(body.capture_seconds || 18) * 1000))
      });
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: 'snapshot_failed', error_description: error?.message || String(error) });
    }
    return true;
  }

  return false;
}
