import { REASONING_OUTPUT_SCHEMA, reasoningSystemInstructions } from './reasoning-schema.mjs';

function outputText(response) {
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return null;
}

function parseJson(text) {
  if (!text) throw new Error('reasoning_provider_returned_no_text');
  try { return JSON.parse(text); }
  catch { throw new Error('reasoning_provider_returned_invalid_json'); }
}

function attestedUrls(response) {
  const urls = new Set();
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type === 'url_citation' && typeof annotation.url === 'string') {
          urls.add(annotation.url);
        }
      }
    }
  }
  return [...urls];
}

export function buildOpenAIRequest(packet, {
  model = process.env.LEARNING_REASONING_MODEL,
  enableWebSearch = String(process.env.LEARNING_REASONING_WEB_SEARCH || 'false').toLowerCase() === 'true'
} = {}) {
  if (!model) throw new Error('LEARNING_REASONING_MODEL is required');
  const maxOutputTokens = Math.max(500, Math.min(4000, Number(process.env.LEARNING_REASONING_MAX_OUTPUT_TOKENS || 1800)));
  const body = {
    model,
    store: false,
    max_output_tokens: maxOutputTokens,
    instructions: reasoningSystemInstructions(),
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: JSON.stringify(packet)
      }]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'shadow_reasoning_proposals',
        strict: true,
        schema: REASONING_OUTPUT_SCHEMA
      }
    }
  };
  if (enableWebSearch) body.tools = [{ type: 'web_search' }];
  return body;
}

export function createReasoningProvider({
  provider = process.env.LEARNING_REASONING_PROVIDER || 'disabled',
  apiKey = process.env.OPENAI_API_KEY,
  baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model = process.env.LEARNING_REASONING_MODEL,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalized = String(provider).toLowerCase();

  if (normalized === 'disabled') {
    return {
      name: 'disabled',
      model: null,
      async reason() {
        return { skipped: true, reason: 'reasoning_provider_disabled' };
      }
    };
  }

  if (normalized === 'mock') {
    return {
      name: 'mock',
      model: 'mock',
      async reason(packet) {
        const raw = process.env.LEARNING_REASONING_MOCK_JSON;
        if (raw) return { output: parseJson(raw), raw_response: { mock: true }, usage: null };
        const firstAsset = Object.keys(packet?.market?.current_features?.assets || {})[0] || 'BTC';
        const observedAt = packet?.market?.generated_at || new Date().toISOString();
        return {
          output: {
            summary: 'Mock HOLD for validation',
            proposals: [{
              asset: firstAsset,
              action: 'HOLD',
              thesis: {
                reason: 'Mock provider does not create risk-on or risk-off actions',
                confirmations: [],
                invalidations: []
              },
              evidence_families: [],
              reward_risk: null,
              entry_price_usd: null,
              invalidation_price_usd: null,
              target_price_usd: null,
              reduction_pct: null,
              risk_pct: null,
              macro_context: {
                regime: 'neutral',
                liquidity: 'stable',
                shock_risk: 'medium',
                observed_at: observedAt,
                evidence: ['mock macro evidence one', 'mock macro evidence two'],
                source_quality: 'mock',
                verification_status: 'verified',
                sources: [
                  { name: 'mock-primary', url: 'https://example.com/primary', kind: 'primary', published_at: observedAt },
                  { name: 'mock-reuters', url: 'https://example.com/reuters', kind: 'reuters', published_at: observedAt }
                ]
              },
              data_confidence: 50,
              source_conflict: false,
              kill_switch: false
            }]
          },
          raw_response: { mock: true },
          usage: null,
          evidence: { web_search_used: false, web_search_calls: 0, provider_attested_sources: false, attested_urls: [] }
        };
      }
    };
  }

  if (normalized !== 'openai_responses') throw new Error(`unsupported_reasoning_provider:${provider}`);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for openai_responses');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');

  return {
    name: 'openai_responses',
    model,
    async reason(packet) {
      const request = buildOpenAIRequest(packet, { model });
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(request)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`reasoning_provider_http_${response.status}:${body?.error?.message || 'unknown_error'}`);
      }
      const text = outputText(body);
      const webSearchCalls = (body.output || []).filter(item =>
        String(item?.type || '').includes('web_search')
      ).length;
      const webSearchUsed = webSearchCalls > 0;
      const urls = attestedUrls(body);
      return {
        output: parseJson(text),
        raw_response: {
          id: body.id ?? null,
          status: body.status ?? null,
          model: body.model ?? model,
          output: body.output ?? null
        },
        usage: body.usage ?? null,
        evidence: {
          web_search_used: webSearchUsed,
          web_search_calls: webSearchCalls,
          provider_attested_sources: webSearchUsed && urls.length > 0,
          attested_urls: urls
        }
      };
    }
  };
}
