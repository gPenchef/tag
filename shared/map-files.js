const fs = require('fs');
const path = require('path');
const { validateMap } = require('./map-schema');

const mapDirectory = path.join(__dirname, 'maps');

function loadExternalMaps(config, directory = mapDirectory) {
  if (!fs.existsSync(directory)) return {};
  const configuredMaps = config.maps || {};
  const maps = {};
  fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((first, second) => {
      const defaultMapFile = `${config.defaultMapId}.json`;
      if (first.name === defaultMapFile) return -1;
      if (second.name === defaultMapFile) return 1;
      return first.name.localeCompare(second.name);
    })
    .forEach((entry) => {
      const filePath = path.join(directory, entry.name);
      let map;
      try {
        map = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        throw new Error(`Could not read map file ${entry.name}: ${error.message}`);
      }
      const errors = validateMap(map, config);
      if (errors.length) throw new Error(`Invalid map file ${entry.name}: ${errors.join(' ')}`);
      if (configuredMaps[map.id] || maps[map.id]) throw new Error(`Duplicate map id "${map.id}" in ${entry.name}.`);
      maps[map.id] = map;
    });
  return maps;
}

module.exports = { mapDirectory, validateMap, loadExternalMaps };
