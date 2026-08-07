# Map files

This folder contains every map used by the game. The server loads every `.json` file here when it starts, validates it, and adds it to the lobby map cards.

To make a loaded map selectable, add its `id` to `enabledMapIds` in `shared/game-config.json`. Remove an ID from that list to keep its file but hide it from the game.

To import a map your friend sends you:

```sh
npm run map:import -- path/to/friend-map.json
```

The importer refuses malformed maps, duplicate IDs, and overwriting an existing file. Commit the new `shared/maps/<map-id>.json` file, then restart the server.

To create the file visually, run `npm run mapmaker` and open `http://localhost:3001`.

Every exported map needs this shape:

```json
{
  "id": "sky-bridge",
  "name": "Sky Bridge",
  "description": "A fast arena with risky upper routes.",
  "arena": { "width": 1800, "height": 1000 },
  "theme": {
    "skyTop": "#17283d",
    "skyBottom": "#0a0d12",
    "accent": "#67e8f9"
  },
  "platforms": [
    { "x": 0, "y": 960, "width": 1800, "height": 40 }
  ],
  "jumpPads": [],
  "spawns": [
    { "x": 120, "y": 940 },
    { "x": 1660, "y": 940 }
  ]
}
```
