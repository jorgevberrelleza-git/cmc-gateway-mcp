export const REASONING_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'proposals'],
  properties: {
    summary: { type: 'string' },
    proposals: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'asset','action','thesis','evidence_families','reward_risk',
          'entry_price_usd','invalidation_price_usd','target_price_usd',
          'reduction_pct','risk_pct','macro_context','data_confidence',
          'source_conflict','kill_switch'
        ],
        properties: {
          asset: { type: 'string' },
          action: { type: 'string', enum: ['HOLD','BUY','REDUCE','SELL','MOVE_TO_USD'] },
          thesis: {
            type: 'object',
            additionalProperties: false,
            required: ['reason','confirmations','invalidations'],
            properties: {
              reason: { type: 'string' },
              confirmations: { type: 'array', items: { type: 'string' } },
              invalidations: { type: 'array', items: { type: 'string' } }
            }
          },
          evidence_families: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['structure','relative_strength','fundamentals','macro','microstructure','portfolio_risk','catalyst','flow','venue']
            }
          },
          reward_risk: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          entry_price_usd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          invalidation_price_usd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          target_price_usd: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          reduction_pct: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          risk_pct: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          macro_context: {
            type: 'object',
            additionalProperties: false,
            required: ['regime','liquidity','shock_risk','observed_at','evidence','source_quality'],
            properties: {
              regime: { type: 'string', enum: ['favorable','neutral','adverse'] },
              liquidity: { type: 'string', enum: ['expanding','stable','contracting'] },
              shock_risk: { type: 'string', enum: ['low','medium','high'] },
              observed_at: { type: 'string' },
              evidence: { type: 'array', minItems: 2, items: { type: 'string' } },
              source_quality: { type: 'string' }
            }
          },
          data_confidence: { type: 'number', minimum: 0, maximum: 100 },
          source_conflict: { type: 'boolean' },
          kill_switch: { type: 'boolean' }
        }
      }
    }
  }
});

export function reasoningSystemInstructions() {
  return [
    'You are the shadow reasoning layer of a crypto portfolio learning system.',
    'You never place or authorize real orders. execution_enabled is always false.',
    'Use only evidence in the supplied packet plus fresh web evidence when web search is enabled.',
    'Prefer official/primary sources and Reuters for macro/catalysts. Treat aggregators and social claims as lower confidence.',
    'Do not claim manipulation, spoofing, whale intent, or stop hunting without observable evidence.',
    'A price decline by itself must never justify moving capital to USD.',
    'For BUY, require at least three independent evidence families and reward/risk >= 2.',
    'For REDUCE/SELL/MOVE_TO_USD, require multiple independent evidence families and respect deterministic persistence supplied in the packet.',
    'If macro evidence is missing, stale, contradictory, or unverifiable, choose HOLD rather than inventing a macro regime.',
    'Do not chase >5% daily candles without breakout/retest, spot confirmation, fresh catalyst, and acceptable crowding.',
    'The objective is expected compound growth under strict drawdown/risk-of-ruin constraints, not maximizing trade frequency.',
    'Return concise structured proposals only.'
  ].join('\n');
}
