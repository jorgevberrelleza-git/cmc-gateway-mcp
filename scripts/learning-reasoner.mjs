import { buildReasoningPacket, sanitizeReasoningPacketForProvider } from '../src/learning/reasoning-packet.mjs';
import { createReasoningProvider } from '../src/learning/reasoning-provider.mjs';
import { assessReasoningProposal } from '../src/learning/reasoning-bridge.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const enabled = String(process.env.LEARNING_REASONING_ENABLED || 'false').toLowerCase() === 'true';
if (!enabled) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: 'LEARNING_REASONING_ENABLED is not true',
    execution_enabled: false
  }));
  process.exit(0);
}

const maxItems = Math.max(1, Math.min(10, Number(process.env.LEARNING_REASONING_MAX_ITEMS || 3)));
const provider = createReasoningProvider();
const store = createLearningStore();
const summary = { claimed: 0, processed: 0, accepted_decisions: 0, rejected_proposals: 0, provider_errors: 0, stale_requeued: 0 };

try {
  const requeued = await store.requeueStaleDecisionQueue(Number(process.env.LEARNING_REASONING_STALE_MINUTES || 30));
  summary.stale_requeued = requeued.length;
  for (let count = 0; count < maxItems; count++) {
    const queueItem = await store.claimNextDecisionQueue();
    if (!queueItem) break;
    summary.claimed += 1;

    let run = null;
    try {
      const snapshotRow = await store.getSnapshotById(queueItem.snapshot_id);
      if (!snapshotRow) throw new Error('queue_snapshot_not_found');

      const snapshotTime = Date.parse(snapshotRow.generated_at);
      const from = new Date(snapshotTime - 24 * 60 * 60 * 1000).toISOString();
      const recentSnapshots = await store.snapshotsBetween(from, snapshotRow.generated_at, 100);
      const pointInTimePortfolio = await store.portfolioMarkAtOrBefore(snapshotRow.generated_at);
      const recentDecisions = await store.listDecisions({ to: snapshotRow.generated_at, limit: 50 });
      const watchdogEvents = await store.listWatchdogEvents({ to: snapshotRow.generated_at, limit: 50 });

      const packet = buildReasoningPacket({
        queueItem,
        snapshotRow,
        recentSnapshots,
        latestPortfolioMark: pointInTimePortfolio,
        recentDecisions,
        watchdogEvents
      });

      const providerPacket = sanitizeReasoningPacketForProvider(packet);
      const maxEventAgeHours = Math.max(1, Number(process.env.LEARNING_REASONING_MAX_EVENT_AGE_HOURS || 6));
      const eventAgeHours = (Date.now() - Date.parse(snapshotRow.generated_at)) / 3_600_000;
      if (Number.isFinite(eventAgeHours) && eventAgeHours > maxEventAgeHours) {
        run = await store.startReasoningRun({
          queueId: queueItem.id,
          provider: provider.name,
          model: provider.model,
          requestPacket: providerPacket
        });
        await store.finishReasoningRun(run.id, {
          status: 'skipped',
          validationSummary: {
            skipped: true,
            reason: 'material_event_too_old_for_new_shadow_decision',
            event_age_hours: eventAgeHours,
            max_event_age_hours: maxEventAgeHours
          }
        });
        await store.finishQueueItem(queueItem.id, {
          status: 'skipped',
          errorMessage: 'material_event_too_old_for_new_shadow_decision'
        });
        summary.processed += 1;
        continue;
      }

      run = await store.startReasoningRun({
        queueId: queueItem.id,
        provider: provider.name,
        model: provider.model,
        requestPacket: providerPacket
      });

      const reasoned = await provider.reason(providerPacket);
      if (reasoned?.skipped) {
        await store.finishReasoningRun(run.id, {
          status: 'skipped',
          responsePayload: reasoned,
          validationSummary: { skipped: true }
        });
        await store.finishQueueItem(queueItem.id, { status: 'skipped' });
        summary.processed += 1;
        continue;
      }

      const proposals = Array.isArray(reasoned?.output?.proposals) ? reasoned.output.proposals : [];
      if (!proposals.length) throw new Error('reasoning_output_has_no_proposals');

      const acceptedIds = [];
      const rejected = [];
      const validationSummary = [];
      const seenAssets = new Set();

      for (let index = 0; index < proposals.length; index++) {
        const proposal = proposals[index];
        const proposalAsset = String(proposal?.asset || '').toUpperCase();
        if (seenAssets.has(proposalAsset)) {
          const duplicate = {
            proposal_index: index,
            asset: proposalAsset,
            action: proposal?.action,
            errors: ['duplicate_asset_proposal'],
            quality: null
          };
          rejected.push(duplicate);
          validationSummary.push({ ...duplicate, accepted: false });
          summary.rejected_proposals += 1;
          continue;
        }
        seenAssets.add(proposalAsset);
        const assessment = assessReasoningProposal(proposal, packet, {
          maxMacroAgeHours: Number(process.env.LEARNING_MACRO_MAX_AGE_HOURS || 12),
          maxRiskPct: Number(process.env.LEARNING_MAX_RISK_PCT || 0.01),
          defaultRiskPct: Number(process.env.LEARNING_DEFAULT_RISK_PCT || 0.005),
          maxPositionPct: Number(process.env.LEARNING_MAX_POSITION_PCT || 0.20),
          maxNewExposurePct: Number(process.env.LEARNING_MAX_NEW_EXPOSURE_PCT || 0.10),
          feeRate: Number(process.env.LEARNING_PAPER_FEE_RATE || 0.001),
          slippageBps: Number(process.env.LEARNING_PAPER_SLIPPAGE_BPS || 10),
          macroSourceAttested: reasoned?.evidence?.provider_attested_sources === true,
          attestedMacroUrls: reasoned?.evidence?.attested_urls || []
        });

        validationSummary.push({
          asset: proposal.asset,
          action: proposal.action,
          accepted: assessment.accepted,
          errors: assessment.errors,
          quality: assessment.quality
        });

        if (!assessment.accepted) {
          rejected.push({
            proposal_index: index,
            asset: proposal.asset,
            action: proposal.action,
            errors: assessment.errors,
            quality: assessment.quality
          });
          summary.rejected_proposals += 1;
          continue;
        }

        const asset = assessment.validation.normalized.asset;
        const action = assessment.validation.normalized.action;
        const decisionKey = `AIQ${queueItem.id}-${asset}-${index}`;
        let decision = await store.saveDecision({
          decisionKey,
          snapshotId: snapshotRow.id,
          asset,
          action,
          decisionType: action,
          status: 'shadow_accepted',
          thesis: {
            ...proposal.thesis,
            reasoning_summary: reasoned.output.summary,
            evidence_families: assessment.validation.normalized.evidence_families,
            macro_context: assessment.validation.normalized.macro_context,
            decision_quality: assessment.quality,
            provider: provider.name,
            model: provider.model
          },
          riskContext: {
            validation_errors: assessment.errors,
            deterministic_persistence: assessment.validation.normalized.persistence,
            macro_validation: assessment.validation.macro_validation,
            reward_risk: assessment.validation.normalized.reward_risk,
            execution_enabled: false
          },
          portfolioContext: packet.portfolio || {}
        });
        if (!decision) decision = await store.getDecisionByKey(decisionKey);
        if (!decision) throw new Error(`decision_persistence_failed:${decisionKey}`);

        if (assessment.paper_order) {
          let paper = await store.savePaperOrder({
            decisionId: decision.id,
            symbol: asset,
            side: assessment.paper_order.side,
            quantity: assessment.paper_order.quantity,
            notionalUsd: assessment.paper_order.notional_usd,
            referencePriceUsd: assessment.paper_order.reference_price_usd,
            invalidationPriceUsd: assessment.paper_order.invalidation_price_usd ?? proposal.invalidation_price_usd ?? null,
            targetPriceUsd: assessment.paper_order.target_price_usd ?? proposal.target_price_usd ?? null,
            estimatedFeeUsd: assessment.paper_order.estimated_fee_usd,
            estimatedSlippageBps: assessment.paper_order.estimated_slippage_bps,
            state: 'proposed'
          });
          if (!paper) {
            const existing = await store.paperOrdersForDecision(decision.id);
            paper = existing.find(x => String(x.symbol).toUpperCase() === asset) || null;
          }
          if (!paper) throw new Error(`paper_order_persistence_failed:${decisionKey}`);
        }

        acceptedIds.push(decision.id);
        summary.accepted_decisions += 1;
      }

      await store.finishReasoningRun(run.id, {
        status: acceptedIds.length ? 'completed' : 'rejected',
        responsePayload: {
          output: reasoned.output,
          provider_response: reasoned.raw_response ?? null,
          provider_evidence: reasoned.evidence ?? null
        },
        validationSummary,
        acceptedDecisionIds: acceptedIds,
        rejectedProposals: rejected,
        usage: reasoned.usage ?? null
      });

      await store.finishQueueItem(queueItem.id, {
        status: 'processed',
        decisionId: acceptedIds[0] ?? null
      });
      summary.processed += 1;
    } catch (error) {
      summary.provider_errors += 1;
      const message = error?.message || String(error);
      if (run?.id) {
        await store.finishReasoningRun(run.id, {
          status: 'error',
          errorMessage: message
        }).catch(() => {});
      }
      await store.releaseQueueItem(queueItem.id, { errorMessage: message }).catch(() => {});
    }
  }

  console.log(JSON.stringify({
    ok: summary.provider_errors === 0,
    provider: provider.name,
    model: provider.model,
    ...summary,
    execution_enabled: false
  }));
  if (summary.provider_errors > 0) process.exitCode = 1;
} finally {
  await store.close();
}
