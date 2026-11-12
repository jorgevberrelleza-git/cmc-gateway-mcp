import { buildTradingSnapshot } from '../src/research.mjs';
import { detectMaterialEvent } from '../src/learning/event-detector.mjs';
import { buildDecisionQueueItem } from '../src/learning/decision-queue.mjs';
import { classifyResearchQueueEvent } from '../src/learning/research-queue-gate.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';
import { decideCmcMcpProbe } from '../src/learning/cmc-mcp-circuit.mjs';
import { decideCmcPublicProbe } from '../src/learning/cmc-public-rate-circuit.mjs';

function parseAssets() {
  return String(process.env.LEARNING_ASSETS || 'BTC,AAVE,ADA')
    .split(',')
    .map(x => x.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 3);
}

const captureMs = Math.max(6000, Math.min(45000, Number(process.env.LEARNING_CAPTURE_MS || 18000)));
const source = process.env.LEARNING_SOURCE || 'cron';
const store = createLearningStore();

try {
  const recentRows = await store.recentSnapshots(36);
  const previousRow = recentRows[0] || null;
  const cmcMcpCircuit = decideCmcMcpProbe(recentRows,{enabled:String(process.env.LEARNING_CMC_MCP_CIRCUIT_ENABLED||'false').toLowerCase()==='true'});
  const cmcPublicCircuit=decideCmcPublicProbe(recentRows,{enabled:String(process.env.LEARNING_CMC_PUBLIC_RATE_CIRCUIT_ENABLED||'false').toLowerCase()==='true'});
  const snapshot = await buildTradingSnapshot({
    cmcMcpCircuit,
    cmcPublicCircuit,
    assets: parseAssets(),
    includeMicrostructure: String(process.env.LEARNING_INCLUDE_MICROSTRUCTURE || 'true').toLowerCase() !== 'false',
    captureMs
  });

  const materialEvent = previousRow?.payload
    ? detectMaterialEvent(previousRow.payload, snapshot)
    : {
        material: false,
        reasons: ['bootstrap_baseline'],
        per_asset: {},
        previous_generated_at: null,
        current_generated_at: snapshot.generated_at,
        policy: 'bootstrap'
      };

  const saved = await store.saveSnapshot(snapshot, { source, materialEvent });
  let queued = null;
  const queueGate=classifyResearchQueueEvent(materialEvent,{
    enabled:String(process.env.LEARNING_RESEARCH_QUEUE_GATE_ENABLED||'false').toLowerCase()==='true'
  });
  const queueItem=queueGate.should_queue ? buildDecisionQueueItem(saved, materialEvent) : null;
  if (queueItem) queued = await store.enqueueDecisionReview({
    snapshotId: queueItem.snapshot_id,
    queueKey: queueItem.queue_key,
    priority: queueItem.priority,
    materialEvent: queueItem.material_event
  });

  console.log(JSON.stringify({
    ok: true,
    snapshot_id: saved.id,
    generated_at: saved.generated_at,
    sha256: saved.sha256,
    material_event: materialEvent.material,
    reasons: materialEvent.reasons,
    research_queue_gate:queueGate,
    cmc_mcp_circuit:cmcMcpCircuit,
    decision_queue: queued ? {
      id: queued.id,
      status: queued.status,
      priority: queued.priority
    } : null,
    execution_enabled: false
  }));
} finally {
  await store.close();
}
