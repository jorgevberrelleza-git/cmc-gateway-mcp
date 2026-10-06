const BASE = String(process.env.DEFILLAMA_BASE_URL || 'https://api.llama.fi').replace(/\/$/, '');
const TIMEOUT_MS = Math.max(3000, Number(process.env.DEFILLAMA_TIMEOUT_MS || 12000));

async function getJson(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'cmc-gateway-mcp/0.6.1'
      },
      signal: controller.signal
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`DefiLlama HTTP ${r.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export const defillama = {
  protocols: () => getJson('/protocols'),
  protocol: slug => getJson(`/protocol/${encodeURIComponent(slug)}`),
  currentTvl: slug => getJson(`/tvl/${encodeURIComponent(slug)}`),
  feeSummary: (slug, dataType = 'dailyFees') => getJson(`/summary/fees/${encodeURIComponent(slug)}`, { dataType }),
  stablecoinChartAll: () => getJson('/stablecoincharts/all')
};

export function defillamaConfig() {
  return { base_url: BASE, timeout_ms: TIMEOUT_MS, auth_required: false };
}
