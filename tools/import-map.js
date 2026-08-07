const fs = require('fs');
const path = require('path');
const config = require('../shared/game-config');
const { mapDirectory, validateMap } = require('../shared/map-files');

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: npm run map:import -- path/to/exported-map.json');
  process.exit(1);
}

const resolvedSourcePath = path.resolve(sourcePath);
let map;
try {
  map = JSON.parse(fs.readFileSync(resolvedSourcePath, 'utf8'));
} catch (error) {
  console.error(`Could not read ${resolvedSourcePath}: ${error.message}`);
  process.exit(1);
}

const errors = validateMap(map, config);
if (errors.length) {
  console.error(`Map was not imported:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
if (config.maps[map.id]) {
  console.error(`Map id "${map.id}" is already in use.`);
  process.exit(1);
}

const destinationPath = path.join(mapDirectory, `${map.id}.json`);
if (fs.existsSync(destinationPath)) {
  console.error(`Map file already exists: ${destinationPath}`);
  process.exit(1);
}

fs.mkdirSync(mapDirectory, { recursive: true });
fs.writeFileSync(destinationPath, `${JSON.stringify(map, null, 2)}\n`);
console.log(`Imported ${map.name} as shared/maps/${map.id}.json. Add "${map.id}" to enabledMapIds in shared/game-config.json to use it in-game.`);
