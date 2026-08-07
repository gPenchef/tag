# Platform Tag

Platform Tag is a local two-player, real-time tag game built with Node.js, Express, Socket.IO, and an HTML5 Canvas client. One player is the runner and the other is the chaser. Players choose powers before each round, then compete across a selected parkour map.

## Run locally

Requirements: Node.js 20 or newer is recommended.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in two browser windows. To use another port:

```sh
PORT=3001 npm start
```

For server-side development with automatic restarts:

```sh
npm run dev
```

## Mapmaker

Run the standalone map editor on its own local server:

```sh
npm run mapmaker
```

Open [http://localhost:3001](http://localhost:3001). Draw platforms, place jump pads and both player spawns, then choose **Export JSON**. The editor uses the same validation rules as the game importer.

Copy the exported file into the game with:

```sh
npm run map:import -- path/to/exported-map.json
```

Restart the game server after importing. The new map and its generated preview card will appear in the lobby automatically.

## Creating and joining a match

1. Enter a display name.
2. The host chooses a map and creates a lobby.
3. Share the five-character lobby code with the second player.
4. The second player enters their name and joins with the code.
5. The runner chooses a power first. The chaser then sees that choice and chooses a counter.
6. After the countdown, the match begins. Roles swap after each completed round.

The host’s map choice is server-authoritative and remains active for every rematch in that lobby.

## Controls

| Action | Keyboard / mouse |
| --- | --- |
| Move | `A`/`D` or Left/Right Arrow |
| Jump | `Space` or Up Arrow |
| Dash | `Shift` when Dash is selected |
| Realm Shift | `E` when Realm Shift is selected |
| Snowball aim | Mouse position |
| Snowball fire | Left mouse button when Snowball Gun is selected |

Controls are only captured while the game screen is active. Snowball aiming uses the current camera view to convert the pointer into world coordinates.

## Powers

Power definitions are in `shared/game-config.json` under `powers`.

- **Dash**: a short horizontal burst with a 1.25 second cooldown.
- **Double Jump**: grants one additional airborne jump and refreshes on landing.
- **Snowball Gun**: fires a server-authoritative projectile and stuns the other player for 1.5 seconds. Cooldown: 7 seconds.
- **Realm Shift**: separates the activating player for 2 seconds. Players in different realms cannot tag or hit one another. Cooldown: 15 seconds.

Cooldown values, movement values, projectile values, and visual meter colors can be adjusted in the JSON configuration. Restart the server after changing it.

## Maps and configuration

`shared/game-config.json` holds shared gameplay settings. Every map lives in its own validated JSON file in `shared/maps/`; `shared/game-config.js` loads them dynamically, while `server.js` exposes the resulting data at `/game-config.js` for the browser.

Friend-created maps use one self-contained JSON export. Import one with:

```sh
npm run map:import -- path/to/exported-map.json
```

The import command validates the data, prevents duplicate map IDs and overwrites, then saves it as `shared/maps/<map-id>.json`. See [shared/maps/README.md](shared/maps/README.md) for the exact export format. Restart the server after importing.

`enabledMapIds` in `shared/game-config.json` controls which loaded map files are playable. Add a map ID to enable it in the lobby; remove it to keep the file but disable it.

Each `shared/maps/*.json` file contains one complete map:

```json
{
  "name": "Example Arena",
  "description": "Short description shown in the lobby.",
  "arena": { "width": 1800, "height": 1000 },
  "theme": {
    "skyTop": "#17283d",
    "skyBottom": "#0a0d12",
    "accent": "#67e8f9"
  },
  "platforms": [
    { "x": 0, "y": 960, "width": 1800, "height": 40 }
  ],
  "jumpPads": [
    { "x": 850, "y": 950, "width": 60, "height": 10, "launchSpeed": 950 }
  ],
  "spawns": [
    { "x": 120, "y": 940 },
    { "x": 1660, "y": 940 }
  ]
}
```

The current maps are `spire`, `crossroads`, and `overpass`. `defaultMapId` controls the fallback map used when a match receives an unknown map ID.

When adding a map, keep these invariants true:

- Platform, jump-pad, and spawn rectangles must stay inside `arena`.
- There must be exactly two spawn points.
- A spawn’s `y` coordinate should place the player on a platform or the floor (`spawn.y + player.height` equals the supporting surface).
- Jump pads should overlap a platform’s top surface and have enough room for the player to land.
- Test the map at both camera zoom limits and near every boundary.

The physics engine reads the selected map for arena clamping, platform collision, jump-pad activation, projectile collision, projectile lifetime bounds, and round resets. The client reads it for rendering and camera framing, so maps can have different widths and heights without changing gameplay code.

## Project structure

```text
server.js                  Express and Socket.IO entry point
server/game.js             Authoritative match simulation and powers
server/lobbies.js          Lobby lifecycle and map selection persistence
shared/game-config.json    Shared gameplay, power, camera, and map data
shared/game-config.js      CommonJS loader for the shared JSON
shared/maps/               Imported mapmaker exports
tools/import-map.js        Validated map import command
mapmaker/                  Standalone visual JSON map editor
public/index.html          Browser entry point and lobby markup
public/app.js              Socket client, input, camera, and Canvas rendering
public/styles.css          Lobby and in-game presentation
test/game.test.js          Deterministic gameplay and configuration tests
```

The server owns movement, collision, power activation, tagging, stun timing, realm interaction, and round state. Clients send input and display the public match state; they do not decide hits or winners.

## Socket events

Client-to-server events:

- `lobby:create` with `{ name, mapId }`
- `lobby:join` with `{ name, code }`
- `lobby:leave`
- `input:update` with movement and ability button states
- `power:select` with `{ powerId }`
- `power:use` with `{ target: { x, y } }` for Snowball Gun
- `match:rematch`

Server-to-client events:

- `lobby:state` contains the lobby code, players, selected map, and match availability.
- `game:state` contains the public phase, selected map ID, players, projectiles, scores, timers, and result.
- `lobby:error` contains validation or lobby errors.
- `game:notice` communicates disconnect/forfeit notices.

All client-supplied names, lobby codes, map IDs, power IDs, input values, and snowball targets are validated at the Socket.IO boundary.

## Testing

Run the full test suite with:

```sh
npm test
```

The tests cover power-selection order, all existing movement mechanics, dashes, double jumps, snowballs, stun timing, realm separation, jump pads, tagging, timeout, role swaps, map geometry, selected-map spawns and bounds, and lobby map propagation.

## Balancing workflow

Most balance changes should only require editing `shared/game-config.json`:

- `player` controls speed, jump impulse, gravity, and fall speed.
- `powers` controls ability cooldowns, durations, speeds, projectile settings, and colors.
- `round` controls countdown, round length, result pause, and match score target.
- `camera` controls minimum view size, padding, dead zone, and zoom response.
- `maps` controls arena dimensions and all level geometry.

Run `npm test` after configuration changes. Since the browser receives configuration when the server starts serving `/game-config.js`, reload both browser windows after restarting the server.

## Known assumptions

- The game is designed for exactly two players per lobby.
- Maps use axis-aligned rectangles and a shared player size; there is no map-specific physics or gravity yet.
- The canvas camera can show a small amount of background outside an arena when an arena’s aspect ratio does not match the browser viewport; gameplay positions remain clamped to the arena.
- The server runs one fixed simulation interval based on `tickRate` and caps unusually large frame deltas for stability.
