const baseConfig = require('./game-config.json');
const { loadExternalMaps } = require('./map-files');
const { selectEnabledMaps } = require('./map-selection');

const loadedMaps = loadExternalMaps(baseConfig);

module.exports = {
  ...baseConfig,
  maps: selectEnabledMaps(loadedMaps, baseConfig.enabledMapIds, baseConfig.defaultMapId)
};
