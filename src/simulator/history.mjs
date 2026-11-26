// Read-only local history loader. NO remote requests and NO production credentials.
// All file paths are verified to remain inside the explicitly named dataset root.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TIME_MACHINE_ASSETS, TIME_MACHINE_DAY_MS, validateSeries } from './time-machine.mjs';

function requireValid(condition, message) {
  if (!condition) throw new Error('time_machine_history:' + message);
}
function epochToMs(input) {
  const value = Number(input);
  requireValid(Number.isSafeInteger(value) && value > 0, 'invalid_epoch');
  if (value >= 1e14) return Math.floor(value / 1_000); // spot Binance 2025+: microseconds
  if (value >= 1e12) return value; // 2024 and earlier: milliseconds
  throw new Error('time_machine_history:timestamp_unit_not_supported');
}
function parseLine(line) {
  // Public Binance kline CSV is numeric, comma-delimited, without quoted fields.
  // We reject malformed records, rather than use a permissive CSV parser.
  const cols = line.replace(/^\uFEFF/, '').split(',').map(x => x.trim());
  requireValid(cols.length === 12 || cols.length === 6, 'expected_binance_12_columns_or_compact_6');
  return cols;
}
export function parseSpotKlinesCsv(raw, { intervalMs = TIME_MACHINE_DAY_MS } = {}) {
  requireValid(typeof raw === 'string' && raw.length > 0, 'empty_csv');
  requireValid(intervalMs === TIME_MACHINE_DAY_MS || intervalMs === 3_600_000, 'unsupported_interval');
  const lines = raw.split(/\r?\n/).filter(x => x.trim());
  requireValid(lines.length > 0 && lines.length <= 100_001, 'invalid_csv_length');
  const out = [];
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n].trim();
    if (n === 0 && /^(open.?time|timestamp|time),/i.test(l)) continue;
    const fields = parseLine(l);
    const openTime = epochToMs(fields[0]);
    const closeTime = fields.length === 12 ? epochToMs(fields[6]) : openTime + intervalMs - 1;
    out.push({
      openTime, closeTime,
      open: Number(fields[1]),
      high: Number(fields[2]),
      low: Number(fields[3]),
      close: Number(fields[4]),
      volume: Number(fields[5])
    });
  }
  requireValid(out.length >= 3, 'insufficient_bars');
  return out;
}

async function safeLocalFile(root, relativePath) {
  requireValid(typeof relativePath === 'string' && relativePath.length > 0, 'file_required');
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, relativePath);
  requireValid(candidate.startsWith(realRoot + path.sep), 'path_outside_root');
  const realFile = await fs.realpath(candidate);
  requireValid(realFile.startsWith(realRoot + path.sep), 'symlink_outside_root');
  const info = await fs.stat(realFile);
  requireValid(info.isFile() && info.size <= 100_000_000, 'invalid_file_size');
  return realFile;
}
export async function loadHistoryManifest({ root, manifest = 'manifest.json' } = {}) {
  requireValid(typeof root === 'string' && root.length > 0, 'root_required');
  const manifestPath = await safeLocalFile(root, manifest);
  const doc = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  requireValid(doc && doc.format === 'binance_spot_klines_v1', 'invalid_manifest_format');
  requireValid(doc.interval === '1d' || doc.interval === '1h', 'invalid_manifest_interval');
  const stepMs = doc.interval === '1h' ? 3_600_000 : TIME_MACHINE_DAY_MS;
  const series = {};
  const provenance = {};
  for (const asset of TIME_MACHINE_ASSETS) {
    const record = doc.assets?.[asset];
    requireValid(record && /^[a-f0-9]{64}$/i.test(record.sha256 || ''), 'missing_checksum_' + asset);
    const filePath = await safeLocalFile(root, record.file);
    const buffer = await fs.readFile(filePath);
    const observedSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    requireValid(observedSha256 === record.sha256.toLowerCase(), 'checksum_mismatch_' + asset);
    series[asset] = parseSpotKlinesCsv(buffer.toString('utf8'), { intervalMs: stepMs });
    provenance[asset] = {
      file: record.file, sha256: observedSha256,
      bars: series[asset].length, exchange: 'Binance_spot',
      pair: asset + 'USDT'
    };
  }
  const checked = validateSeries(series, { stepMs });
  return { series, intervalMs: stepMs, provenance, datasetId: String(doc.datasetId || 'unknown'), alignedBars: checked.times.length };
}

// Synthetic prices for CI/testing only — these are never claimed to be market data.
export function buildSyntheticHistory({ days = 1_826, from = Date.UTC(2021, 1, 1) } = {}) {
  requireValid(Number.isInteger(days) && days >= 90 && days <= 5000, 'invalid_demo_days');
  const base = { BTC: 30_000, ADA: 0.65, AAVE: 350 };
  const bars = {};
  for (const [asset, seed] of Object.entries(base)) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const trend = 1 + 0.0002 * i;
      const cycle = 1 + 0.13 * Math.sin(i / 39 + (asset === 'AAVE' ? 0.8 : 0));
      const wave = 1 + 0.017 * Math.sin(i / 5 + seed);
      const close = seed * trend * cycle * wave;
      const prior = i === 0 ? seed : out[i - 1].close;
      const open = prior;
      out.push({
        openTime: from + i * TIME_MACHINE_DAY_MS,
        closeTime: from + (i + 1) * TIME_MACHINE_DAY_MS - 1,
        open, close,
        high: Math.max(open, close) * 1.006,
        low: Math.min(open, close) * 0.994,
        volume: 1_000 + ((i * 71) % 400)
      });
    }
    bars[asset] = out;
  }
  return bars;
}
