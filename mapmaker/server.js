const path = require('path');
const express = require('express');
const baseConfig = require('../shared/game-config.json');

const app = express();
app.get('/map-schema.js', (_request, response) => response.sendFile(path.join(__dirname, '..', 'shared', 'map-schema.js')));
app.get('/mapmaker-config.js', (_request, response) => {
  response.type('application/javascript').send(`window.MAPMAKER_CONFIG=${JSON.stringify({ player: baseConfig.player })};`);
});
app.use(express.static(__dirname));

const port = process.env.MAPMAKER_PORT || 3001;
app.listen(port, () => console.log(`TAG Mapmaker listening on http://localhost:${port}`));
