function selectEnabledMaps(loadedMaps, enabledMapIds, defaultMapId) {
  if (!Array.isArray(enabledMapIds) || !enabledMapIds.length) {
    throw new Error('enabledMapIds must list at least one map id.');
  }
  if (!enabledMapIds.every((mapId) => typeof mapId === 'string')) {
    throw new Error('enabledMapIds must contain only map id strings.');
  }
  if (new Set(enabledMapIds).size !== enabledMapIds.length) {
    throw new Error('enabledMapIds cannot contain duplicates.');
  }
  if (!enabledMapIds.includes(defaultMapId)) {
    throw new Error('defaultMapId must be included in enabledMapIds.');
  }
  const missingMapId = enabledMapIds.find((mapId) => !loadedMaps[mapId]);
  if (missingMapId) throw new Error(`enabledMapIds references missing map "${missingMapId}".`);
  return Object.fromEntries(enabledMapIds.map((mapId) => [mapId, loadedMaps[mapId]]));
}

module.exports = { selectEnabledMaps };
