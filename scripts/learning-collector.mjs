import { buildTradingSnapshot } from '../src/research.mjs';
import { detectMaterialEvent } from '../src/learning/event-detector.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

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
  const previousRow = await store.latestSnapshot();
  const snapshot = await buildTradingSnapshot({
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
  console.log(JSON.stringify({
    ok: true,
    snapshot_id: saved.id,
    generated_at: saved.generated_at,
    sha256: saved.sha256,
    material_event: materialEvent.material,
    reasons: materialEvent.reasons
  }));
} finally {
  await store.close();
}
