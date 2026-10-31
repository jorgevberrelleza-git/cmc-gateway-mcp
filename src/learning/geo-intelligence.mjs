import crypto from 'node:crypto';

// Official RSS URLs, verified against the publisher's website on 2026-10-18.
// Keep this allowlist static. OFAC retired its RSS in 2025: do not add a defunct URL.
export const GEO_SOURCES = Object.freeze([
  { id: 'fed_monetary', name: 'Federal Reserve - monetary policy', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', hostname: 'www.federalreserve.gov' },
  { id: 'ecb_press', name: 'European Central Bank - press', url: 'https://www.ecb.europa.eu/rss/press.html', hostname: 'www.ecb.europa.eu' },
  { id: 'eu_council_press', name: 'Council of the European Union - press', url: 'https://www.consilium.europa.eu/en/rss/pressreleases.ashx', hostname: 'www.consilium.europa.eu' }
]);

function textValue(v = '') {
  return String(v).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi,'$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/gi, x => ({
      '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'", '&#x27;': "'"
    })[x.toLowerCase()] || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g,' ').trim();
}
function tag(block, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '\\s*>','i').exec(block);
  return m ? textValue(m[1]) : null;
}
function articleLink(block) {
  const atom = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/i.exec(block);
  return atom ? textValue(atom[1]) : tag(block,'link') || tag(block,'guid');
}
function safeArticleUrl(raw, hostname) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== hostname || u.username || u.password) return null;
    u.hash = '';
    return u.toString().slice(0, 600);
  } catch { return null; }
}
function classify(title, sourceId) {
  const t = title.toLowerCase();
  const patterns = [
    { topic:'monetary_policy', severity:'high', rx:/\b(interest rate|federal funds|monetary policy decision|policy rate|fomc statement|rate cut|rate hike|quantitative tightening|quantitative easing)\b/i },
    { topic:'market_structure', severity:'high', rx:/\b(exchange outage|market disruption|trading suspension|financial stability|liquidity crisis|bank failure)\b/i },
    { topic:'conflict_security', severity:'high', rx:/\b(armed conflict|military strike|invasion|ceasefire collapse|military escalation|military attack)\b/i },
    { topic:'sanctions_trade', severity:'medium', rx:/\b(sanctions|tariff|trade restriction|export control|embargo)\b/i },
    { topic:'crypto_regulation', severity:'medium', rx:/\b(crypto|bitcoin|stablecoin|digital asset|spot etf|tokeniz)\b/i },
    { topic:'macroeconomic', severity:'medium', rx:/\b(inflation|employment|gdp|economic outlook|consumer prices|credit conditions)\b/i }
  ];
  const p = patterns.find(x=>x.rx.test(t));
  if (p) return {topic:p.topic,severity:p.severity};
  return {topic:sourceId==='ecb_press'?'central_bank_other':'official_announcement',severity:'low'};
}

export function parseGeoFeed(xml, source, { now = new Date(), maxAgeHours = 72, maxItems = 60 } = {}) {
  if (typeof xml !== 'string' || xml.length > 600000 || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('geo_feed_invalid_xml');
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].slice(0,maxItems);
  const nowMs = +new Date(now);
  const out = [];
  const keys = new Set();
  for (const [, , block] of blocks) {
    const title = (tag(block,'title') || '').slice(0,240);
    const url = safeArticleUrl(articleLink(block),source.hostname);
    const publishedText = tag(block,'pubDate') || tag(block,'published') || tag(block,'updated') || tag(block,'dc:date');
    const published = publishedText ? Date.parse(publishedText) : NaN;
    if (!title || !url || !Number.isFinite(published) || published > nowMs + 3600000 || nowMs - published > maxAgeHours*3600000) continue;
    const eventKey = crypto.createHash('sha256').update(source.id+'|'+url).digest('hex');
    if (keys.has(eventKey)) continue;
    keys.add(eventKey);
    out.push({
      event_key: eventKey,
      source_id: source.id,
      source_name: source.name,
      article_url: url,
      title,
      published_at: new Date(published).toISOString(),
      ...classify(title,source.id),
      publisher_validated: true,
      confidence: 'publisher_feed_metadata_only',
      execution_enabled: false
    });
  }
  return out;
}

export async function fetchGeoSource(source, { fetchImpl = globalThis.fetch, timeoutMs = 9000, now = new Date() } = {}) {
  if (!GEO_SOURCES.some(s => s.id === source.id && s.url === source.url && s.hostname === source.hostname)) throw new Error('geo_source_not_allowlisted');
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(),Math.min(Math.max(1000,timeoutMs),12000));
  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      headers: { 'accept': 'application/rss+xml, application/xml, text/xml;q=0.9', 'user-agent':'ShadowGEO/0.1 research-only' },
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error('feed_http_'+response.status);
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > 600000) throw new Error('geo_feed_oversize');
    // Bound streamed response size regardless of Content-Length.
    const reader = response.body?.getReader?.();
    let raw = '';
    if (reader) {
      const decoder = new TextDecoder();
      let bytes=0;
      while(true) {
        const { done, value } = await reader.read();
        if(done) break;
        bytes+=value?.byteLength||0;
        if(bytes>600000) { await reader.cancel().catch(()=>{}); throw new Error('geo_feed_oversize'); }
        raw+=decoder.decode(value,{stream:true});
      }
      raw+=decoder.decode();
    } else {
      raw = await response.text();
      if(raw.length>600000) throw new Error('geo_feed_oversize');
    }
    const events = parseGeoFeed(raw,source,{now});
    return { source_id:source.id,ok:true,events,checked_at:new Date(now).toISOString() };
  } finally { clearTimeout(id); }
}

export function buildGeoRiskSummary(events, { sourceStatus = [] } = {}) {
  const fresh = Array.isArray(events) ? events : [];
  const high = fresh.filter(e=>e.severity==='high');
  const medium = fresh.filter(e=>e.severity==='medium');
  const unknown = sourceStatus.length===0 || sourceStatus.every(s=>!s.ok);
  return {
    contract_version:'shadow_geo_v0.1',
    level:unknown?'unknown':high.length?'elevated':medium.length?'watch':'normal',
    high_events:high.length,
    medium_events:medium.length,
    sources_ok:sourceStatus.filter(s=>s.ok).length,
    sources_attempted:sourceStatus.length,
    requires_manual_review:unknown || high.length>0,
    direction_prediction:null,
    authorizes_position_change:false,
    execution_enabled:false,
    disclaimer:'Official feed metadata is not confirmed market impact; primary document reading and market confirmation required.'
  };
}
