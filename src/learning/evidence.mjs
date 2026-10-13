const FAMILY_BY_REASON = [
  [/price_move_/i, 'structure'],
  [/gate_/i, 'microstructure'],
  [/trap_delta_/i, 'microstructure'],
  [/spot_delta_/i, 'microstructure'],
  [/wall_delta_/i, 'microstructure'],
  [/fundamental_quality_delta_/i, 'fundamentals']
];

export function evidenceFamiliesFromReasons(reasons = []) {
  const out = new Set();
  for (const reason of Array.isArray(reasons) ? reasons : []) {
    const text = String(reason || '');
    for (const [pattern, family] of FAMILY_BY_REASON) {
      if (pattern.test(text)) out.add(family);
    }
  }
  return [...out];
}

export function eventEvidenceByAsset(materialEvent = {}) {
  const result = {};
  for (const reason of materialEvent?.reasons || []) {
    const text = String(reason || '');
    const [rawAsset] = text.split(':');
    const asset = String(rawAsset || '').toUpperCase();
    if (!asset) continue;
    if (!result[asset]) result[asset] = new Set();
    for (const family of evidenceFamiliesFromReasons([text])) result[asset].add(family);
  }
  return Object.fromEntries(Object.entries(result).map(([asset, families]) => [asset, [...families]]));
}

export function persistenceObservationsFromSnapshots(rows = [], asset) {
  const symbol = String(asset || '').toUpperCase();
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      const event = row?.material_event || {};
      const byAsset = eventEvidenceByAsset(event);
      const families = byAsset[symbol] || [];
      return {
        observed_at: row?.generated_at || row?.payload?.generated_at || null,
        evidence_families: families
      };
    })
    .filter(x => x.observed_at && x.evidence_families.length > 0);
}
