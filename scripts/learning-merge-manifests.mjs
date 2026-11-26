// Merge per-group Binance manifests (research only) into one manifest under a common root.
import fs from 'node:fs'; import path from 'node:path';
const [root, ...dirs] = process.argv.slice(2);
const out = { assets: {}, merged: dirs };
for (const d of dirs) {
  const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  for (const [a, meta] of Object.entries(m.assets)) out.assets[a] = { ...meta, file: path.relative(root, path.join(d, meta.file)) };
}
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(out, null, 2));
console.log('MERGED ' + Object.keys(out.assets).join(','));
