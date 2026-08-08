const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createMatch,
  selectPower,
  fireSnowball,
  fireWallGun,
  requestRoundRestart,
  respondToRoundRestart,
  tickMatch,
  publicMatch
} = require('../server/game');
const {
  createLobby,
  joinLobby,
  spectateLobby,
  removePlayer,
  removeSpectator
} = require('../server/lobbies');
const CONFIG = require('../shared/game-config');
const JSON_CONFIG = require('../shared/game-config.json');
const { validateMap, loadExternalMaps } = require('../shared/map-files');
const { selectEnabledMaps } = require('../shared/map-selection');
const TEST_MAP = CONFIG.maps[CONFIG.defaultMapId];

function players() { return [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]; }

function startRound(match, runnerPower = 'double-jump', chaserPower = 'dash') {
  const runner = match.players.find((player) => player.role === 'runner');
  const chaser = match.players.find((player) => player.role === 'chaser');
  assert.equal(selectPower(match, runner.id, runnerPower, 1_000), true);
  assert.equal(selectPower(match, chaser.id, chaserPower, 1_000), true);
  const now = match.phaseEndsAt;
  tickMatch(match, 0, now);
  return now;
}

test('the runner chooses a power before the informed chaser', () => {
  const match = createMatch(players());
  const runner = match.players.find((player) => player.role === 'runner');
  const chaser = match.players.find((player) => player.role === 'chaser');

  assert.equal(match.phase, 'power-select');
  assert.equal(match.selectionPlayerId, runner.id);
  assert.equal(selectPower(match, chaser.id, 'dash'), false);
  assert.equal(selectPower(match, runner.id, 'unknown'), false);
  assert.equal(selectPower(match, runner.id, 'double-jump', 1_000), true);
  assert.equal(match.selectionPlayerId, chaser.id);
  assert.equal(publicMatch(match).players.find((player) => player.id === runner.id).power, 'double-jump');

  assert.equal(selectPower(match, chaser.id, 'dash', 1_000), true);
  assert.equal(match.phase, 'countdown');
  assert.equal(match.phaseEndsAt, 1_000 + CONFIG.round.countdownMs);
});

test('every selectable map keeps its geometry, jump pads, and spawns inside its own arena', () => {
  assert.notEqual(CONFIG, JSON_CONFIG);
  assert.equal(JSON_CONFIG.maps, undefined);
  assert.equal(CONFIG.defaultMapId, 'spire');
  assert.deepEqual(JSON_CONFIG.enabledMapIds, ['spire', 'crossroads', 'overpass']);
  assert.equal(CONFIG.maxSpectatorsPerLobby, 8);
  assert.deepEqual(Object.keys(CONFIG.maps), ['spire', 'crossroads', 'overpass']);
  assert.deepEqual(Object.values(CONFIG.maps).map((map) => map.arena.width), [2250, 1680, 2880]);
  assert.deepEqual(Object.values(CONFIG.maps).map((map) => map.arena.height), [1280, 920, 1040]);
  assert.equal(CONFIG.player.width, 20);
  assert.equal(CONFIG.player.height, 20);
  assert.equal(TEST_MAP.platforms.length, 24);
  assert.equal(TEST_MAP.jumpPads.length, 6);
  assert.equal(CONFIG.camera.deadZoneX, 135);
  assert.equal(CONFIG.camera.deadZoneY, 135);
  assert.equal(CONFIG.camera.minViewWidth, 700);
  assert.equal(CONFIG.camera.paddingX, 220);
  assert.equal(CONFIG.camera.zoomOutDeceleration, 900);
  assert.equal(CONFIG.camera.realmZoomOutAcceleration, 5_200);
  assert.equal(CONFIG.camera.realmZoomOutMaxSpeed, 1_800);
  assert.equal(CONFIG.powers.snowball.cooldownMs, 7_000);
  assert.equal(CONFIG.powers.snowball.stunMs, 1_500);
  assert.equal(CONFIG.powers['wall-gun'].cooldownMs, 15_000);
  assert.equal(CONFIG.powers['wall-gun'].maxWallLength, 250);
  assert.equal(CONFIG.powers['wall-gun'].wallThickness, 20);
  assert.equal(CONFIG.powers['wall-gun'].wallDurationMs, 3_000);
  assert.equal(CONFIG.powers.dash.meterColor, '#fb923c');
  assert.equal(CONFIG.powers['double-jump'].meterColor, '#c084fc');
  assert.equal(CONFIG.powers.snowball.meterColor, '#7dd3fc');
  assert.equal(CONFIG.powers['realm-shift'].durationMs, 2_000);
  assert.equal(CONFIG.powers['realm-shift'].cooldownMs, 15_000);
  assert.equal(CONFIG.jumpPadSettings.retriggerLockMs, 100);
  Object.values(CONFIG.maps).forEach((map) => {
    assert.equal(typeof map.name, 'string');
    assert.equal(typeof map.description, 'string');
    assert.equal(map.spawns.length, 2);
    map.platforms.forEach((platform) => {
      assert.ok(platform.x >= 0 && platform.y >= 0);
      assert.ok(platform.x + platform.width <= map.arena.width);
      assert.ok(platform.y + platform.height <= map.arena.height);
    });
    map.spawns.forEach((spawn) => {
      assert.ok(spawn.x >= 0 && spawn.x + CONFIG.player.width <= map.arena.width);
      assert.ok(spawn.y >= 0 && spawn.y + CONFIG.player.height <= map.arena.height);
    });
    map.jumpPads.forEach((pad) => {
      assert.ok(pad.x >= 0 && pad.x + pad.width <= map.arena.width);
      assert.ok(pad.y >= 0 && pad.y + pad.height <= map.arena.height);
      assert.ok(map.platforms.some((platform) =>
        pad.y + pad.height === platform.y &&
        pad.x < platform.x + platform.width && pad.x + pad.width > platform.x
      ));
    });
  });
});

test('only map ids enabled in configuration are exposed to the game', () => {
  const loadedMaps = { spire: { id: 'spire' }, hidden: { id: 'hidden' } };
  assert.deepEqual(selectEnabledMaps(loadedMaps, ['spire'], 'spire'), { spire: loadedMaps.spire });
  assert.throws(() => selectEnabledMaps(loadedMaps, ['hidden'], 'spire'), /defaultMapId/);
  assert.throws(() => selectEnabledMaps(loadedMaps, ['spire', 'missing'], 'spire'), /missing map/);
});

test('a map export is validated before it can be imported', () => {
  const validMap = {
    id: 'friend-map',
    name: 'Friend Map',
    description: 'A map ready for import.',
    arena: { width: 1000, height: 600 },
    theme: { skyTop: '#000000', skyBottom: '#111111', accent: '#ffffff' },
    platforms: [{ x: 0, y: 560, width: 1000, height: 40 }],
    jumpPads: [],
    spawns: [{ x: 100, y: 540 }, { x: 880, y: 540 }]
  };

  assert.deepEqual(validateMap(validMap, CONFIG), []);
  assert.match(validateMap({ ...validMap, id: 'Friend Map' }, CONFIG).join(' '), /Map id/);
  assert.match(validateMap({ ...validMap, spawns: [validMap.spawns[0]] }, CONFIG).join(' '), /exactly two/);
  assert.match(validateMap({ ...validMap, platforms: [{ x: 0, y: 560, width: 1001, height: 40 }] }, CONFIG).join(' '), /platform/);
  assert.match(validateMap({ ...validMap, spawns: [{ x: 100, y: 550 }, validMap.spawns[1]] }, CONFIG).join(' '), /cannot overlap/);
  assert.match(validateMap({ ...validMap, jumpPads: [{ x: 400, y: 500, width: 40, height: 10, launchSpeed: 900 }] }, CONFIG).join(' '), /rest on top/);
});

test('valid custom map exports load from the maps directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-tag-maps-'));
  const map = {
    id: 'custom-test-map',
    name: 'Custom Test Map',
    description: 'A map loaded from a separate file.',
    arena: { width: 1000, height: 600 },
    theme: { skyTop: '#000000', skyBottom: '#111111', accent: '#ffffff' },
    platforms: [{ x: 0, y: 560, width: 1000, height: 40 }],
    jumpPads: [],
    spawns: [{ x: 100, y: 540 }, { x: 880, y: 540 }]
  };

  try {
    fs.writeFileSync(path.join(directory, 'custom-test-map.json'), JSON.stringify(map));
    assert.deepEqual(loadExternalMaps(CONFIG, directory), { 'custom-test-map': map });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a match uses its selected map for identity, spawns, bounds, and public state', () => {
  const map = CONFIG.maps.crossroads;
  const match = createMatch(players(), 'crossroads');

  assert.equal(match.mapId, 'crossroads');
  assert.deepEqual(match.players.map((player) => player.position), map.spawns);
  assert.equal(publicMatch(match).mapId, 'crossroads');

  const now = startRound(match);
  const player = match.players[0];
  player.position = { x: map.arena.width - CONFIG.player.width, y: map.arena.height - CONFIG.player.height };
  player.input.right = true;
  tickMatch(match, 0.1, now + 100);
  assert.equal(player.position.x, map.arena.width - CONFIG.player.width);
});

test('an unknown map id safely falls back to the configured default map', () => {
  const match = createMatch(players(), 'not-a-map');
  assert.equal(match.mapId, CONFIG.defaultMapId);
  assert.deepEqual(match.players.map((player) => player.position), TEST_MAP.spawns);
});

test('the lobby creator map choice is used when the second player starts the match', () => {
  const lobby = createLobby({ id: 'host', name: 'Host' }, 'overpass');
  const result = joinLobby(lobby.code, { id: 'guest', name: 'Guest' });

  assert.equal(result.lobby.mapId, 'overpass');
  assert.equal(result.lobby.match.mapId, 'overpass');
  assert.deepEqual(result.lobby.match.players.map((player) => player.position), CONFIG.maps.overpass.spawns);

  removePlayer(lobby, 'host');
  removePlayer(lobby, 'guest');
});

test('spectators can watch without occupying a player slot or changing the match', () => {
  const lobby = createLobby({ id: 'host', name: 'Host' }, 'spire');
  const spectatorResult = spectateLobby(lobby.code, { id: 'viewer', name: 'Viewer' });
  const playerResult = joinLobby(lobby.code, { id: 'guest', name: 'Guest' });
  const originalMatch = lobby.match;
  const lateSpectatorResult = spectateLobby(lobby.code, { id: 'late-viewer', name: 'Late Viewer' });

  assert.equal(spectatorResult.lobby, lobby);
  assert.equal(playerResult.lobby, lobby);
  assert.equal(lateSpectatorResult.lobby, lobby);
  assert.deepEqual(lobby.players.map((player) => player.id), ['host', 'guest']);
  assert.deepEqual(lobby.spectators.map((spectator) => spectator.id), ['viewer', 'late-viewer']);
  assert.equal(lobby.match, originalMatch);
  assert.equal(lobby.match.players.some((player) => player.id === 'viewer'), false);

  removeSpectator(lobby, 'viewer');
  assert.deepEqual(lobby.spectators.map((spectator) => spectator.id), ['late-viewer']);
  removePlayer(lobby, 'host');
  removePlayer(lobby, 'guest');
});

test('spectators need unique names and are limited by configuration', () => {
  const lobby = createLobby({ id: 'host', name: 'Host' }, 'spire');

  assert.match(spectateLobby(lobby.code, { id: 'duplicate', name: 'host' }).error, /different display name/);
  for (let index = 0; index < CONFIG.maxSpectatorsPerLobby; index += 1) {
    assert.equal(spectateLobby(lobby.code, { id: `viewer-${index}`, name: `Viewer ${index}` }).lobby, lobby);
  }
  assert.match(spectateLobby(lobby.code, { id: 'extra', name: 'Extra' }).error, /too many spectators/);

  removePlayer(lobby, 'host');
});

test('touching the runner immediately awards the chaser', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const chaser = match.players.find((player) => player.role === 'chaser');
  const runner = match.players.find((player) => player.role === 'runner');
  runner.position = { ...chaser.position };
  tickMatch(match, 0, now + 1);
  assert.equal(match.phase, 'result');
  assert.equal(match.result.winnerId, chaser.id);
  assert.equal(match.result.reason, 'tag');
  assert.equal(chaser.score, 1);
});

test('the runner wins when the timer expires without contact', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const runner = match.players.find((player) => player.role === 'runner');
  tickMatch(match, 0, match.phaseEndsAt);
  assert.equal(match.phase, 'result');
  assert.equal(match.result.winnerId, runner.id);
  assert.equal(match.result.reason, 'timeout');
});

test('a round restarts only after the other player accepts the request', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const [requester, responder] = match.players;
  const originalRoles = match.players.map((player) => player.role);
  const originalPowers = match.players.map((player) => player.power);
  requester.score = 2;
  responder.score = 1;
  requester.position = { x: 600, y: 600 };

  assert.equal(requestRoundRestart(match, requester.id), true);
  assert.equal(publicMatch(match).restartRequestPlayerId, requester.id);
  assert.equal(requestRoundRestart(match, responder.id), false);
  assert.equal(respondToRoundRestart(match, requester.id, true, now + 100), false);
  assert.equal(respondToRoundRestart(match, responder.id, true, now + 100), true);

  assert.equal(match.phase, 'countdown');
  assert.equal(match.phaseEndsAt, now + 100 + CONFIG.round.countdownMs);
  assert.equal(match.restartRequestPlayerId, null);
  assert.deepEqual(match.players.map((player) => player.position), TEST_MAP.spawns);
  assert.deepEqual(match.players.map((player) => player.role), originalRoles);
  assert.deepEqual(match.players.map((player) => player.power), originalPowers);
  assert.deepEqual(match.players.map((player) => player.score), [2, 1]);
});

test('roles swap after a completed non-final round', () => {
  const match = createMatch(players());
  const originalRoles = match.players.map((player) => player.role);
  startRound(match);
  tickMatch(match, 0, match.phaseEndsAt);
  tickMatch(match, 0, match.phaseEndsAt);
  assert.equal(match.round, 2);
  assert.deepEqual(match.players.map((player) => player.role), originalRoles.map((role) => role === 'chaser' ? 'runner' : 'chaser'));
  assert.equal(match.phase, 'power-select');
  assert.ok(match.players.every((player) => player.power === null));
  assert.equal(match.selectionPlayerId, match.players.find((player) => player.role === 'runner').id);
});

test('players jump only when standing on a platform', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  player.input.up = true;
  tickMatch(match, 0.05, now + 50);
  assert.ok(player.position.y < TEST_MAP.spawns[0].y);
  assert.ok(player.velocity.y < 0);
});

test('releasing jump early does not change the jump impulse', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const [held, released] = match.players;
  held.input.up = true;
  released.input.up = true;
  tickMatch(match, 0.016, now + 16);

  released.input.up = false;
  tickMatch(match, 0.016, now + 32);

  assert.equal(released.velocity.y, held.velocity.y);
  assert.equal(released.position.y, held.position.y);
});

test('players stop when jumping into the underside of a platform', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const platform = TEST_MAP.platforms.find((candidate) => candidate.x === 500 && candidate.y === 920);
  player.position = { x: 520, y: platform.y + platform.height + 3 };
  player.velocity = { x: 0, y: -500 };
  player.grounded = false;

  tickMatch(match, 0.1, now + 100);

  assert.equal(player.position.y, platform.y + platform.height);
  assert.equal(player.velocity.y, 0);
  assert.equal(player.grounded, false);
});

test('players cannot move through either side of a platform', () => {
  const platform = TEST_MAP.platforms.find((candidate) => candidate.x === 500 && candidate.y === 920);

  for (const direction of ['right', 'left']) {
    const match = createMatch(players());
    const now = startRound(match);
    const player = match.players[0];
    player.position = {
      x: direction === 'right' ? platform.x - CONFIG.player.width - 2 : platform.x + platform.width + 2,
      y: platform.y + 5
    };
    player.input[direction] = true;

    tickMatch(match, 0.1, now + 100);

    const expectedX = direction === 'right' ? platform.x - CONFIG.player.width : platform.x + platform.width;
    assert.equal(player.position.x, expectedX);
    assert.equal(player.velocity.x, 0);
  }
});

test('players can jump briefly after leaving a platform edge', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const platform = TEST_MAP.platforms.find((candidate) => candidate.x === 100 && candidate.y === 760);
  player.position = { x: platform.x + platform.width - 10, y: platform.y - CONFIG.player.height };
  player.input.right = true;

  tickMatch(match, 0.1, now + 100);
  assert.equal(player.grounded, false);

  player.input.right = false;
  player.input.up = true;
  tickMatch(match, 0.05, now + 150);

  assert.ok(player.velocity.y < 0);
});

test('players cannot use coyote time after its window expires', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players.find((candidate) => candidate.power === 'dash');
  player.position = { x: 300, y: 350 };
  player.grounded = false;
  player.coyoteTimeRemaining = CONFIG.player.coyoteTimeMs / 1000;

  tickMatch(match, CONFIG.player.coyoteTimeMs / 1000 + 0.01, now + CONFIG.player.coyoteTimeMs + 10);
  player.input.up = true;
  tickMatch(match, 0.01, now + CONFIG.player.coyoteTimeMs + 20);

  assert.ok(player.velocity.y >= 0);
});

test('dash creates a fast horizontal burst and starts its cooldown', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players.find((candidate) => candidate.power === 'dash');
  const startX = player.position.x;
  player.input.right = true;
  player.input.dash = true;

  tickMatch(match, 0.05, now + 50);

  assert.equal(player.velocity.x, CONFIG.powers.dash.speed);
  assert.ok(player.position.x - startX > CONFIG.player.speed * 0.05);
  assert.ok(player.dashCooldownRemaining > 0);
});

test('double jump grants exactly one extra airborne jump', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players.find((candidate) => candidate.power === 'double-jump');
  player.input.up = true;
  tickMatch(match, 0.016, now + 16);
  player.input.up = false;
  tickMatch(match, 0.016, now + 32);
  player.input.up = true;

  tickMatch(match, 0.016, now + 48);

  assert.ok(player.velocity.y < 0);
  assert.equal(player.extraJumpsRemaining, 0);
  assert.equal(publicMatch(match).players.find((candidate) => candidate.id === player.id).extraJumpsRemaining, 0);
  player.input.up = false;
  tickMatch(match, 0.01, now + 58);
  const velocityBeforeThirdPress = player.velocity.y;
  player.input.up = true;
  tickMatch(match, 0.01, now + 68);
  assert.equal(player.extraJumpsRemaining, 0);
  assert.ok(Math.abs(player.velocity.y - velocityBeforeThirdPress - CONFIG.player.gravity * 0.01) < 0.001);
});

test('the snowball gun fires toward a valid aim point and starts its cooldown', () => {
  const match = createMatch(players());
  const now = startRound(match, 'snowball', 'dash');
  const shooter = match.players.find((player) => player.power === 'snowball');
  const target = match.players.find((player) => player.id !== shooter.id);
  shooter.position = { x: 100, y: 1220 };
  target.position = { x: 700, y: 1220 };

  assert.equal(fireSnowball(match, shooter.id, { x: 800, y: 1230 }), true);
  assert.equal(match.projectiles.length, 1);
  assert.equal(shooter.snowballCooldownRemaining, CONFIG.powers.snowball.cooldownMs / 1000);
  assert.ok(match.projectiles[0].velocity.x > 0);
  assert.equal(match.projectiles[0].velocity.y, 0);
  assert.equal(fireSnowball(match, shooter.id, { x: 800, y: 1230 }), false);
  assert.equal(fireSnowball(match, shooter.id, { x: Number.NaN, y: 0 }), false);

  const publicState = publicMatch(match);
  assert.equal(publicState.projectiles.length, 1);
  assert.equal(publicState.players.find((player) => player.id === shooter.id).snowballCooldownMs, CONFIG.powers.snowball.cooldownMs);
  assert.equal(match.phaseEndsAt, now + CONFIG.round.durationMs);
});

test('a snowball stuns the other player for one and a half seconds', () => {
  const match = createMatch(players());
  const now = startRound(match, 'snowball', 'dash');
  const shooter = match.players.find((player) => player.power === 'snowball');
  const target = match.players.find((player) => player.id !== shooter.id);
  shooter.position = { x: 100, y: 1220 };
  target.position = { x: 400, y: 1220 };

  assert.equal(fireSnowball(match, shooter.id, { x: 800, y: 1230 }), true);
  tickMatch(match, 0.35, now + 350);

  assert.equal(match.projectiles.length, 0);
  assert.equal(target.stunRemaining, CONFIG.powers.snowball.stunMs / 1000);
  const stunnedX = target.position.x;
  target.input.right = true;
  tickMatch(match, 0.25, now + 600);
  assert.equal(target.position.x, stunnedX);
  assert.equal(target.stunRemaining, 1.25);
});

test('the wall gun creates one maximum-length wall perpendicular to the surface it hits', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  builder.position = { x: 830, y: 800 };

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  assert.equal(builder.wallGunCooldownRemaining, 15);
  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), false);
  tickMatch(match, 0.1, now + 100);

  assert.equal(match.walls.length, 1);
  assert.deepEqual(
    { x: match.walls[0].x, y: match.walls[0].y, width: match.walls[0].width, height: match.walls[0].height },
    { x: 830, y: 630, width: 20, height: 250 }
  );
  assert.equal(publicMatch(match).players.find((player) => player.id === builder.id).wallGunCooldownMs, 14_900);
  assert.equal(publicMatch(match).walls.length, 1);
});

test('a wall gun wall stops at the nearest obstacle', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  builder.position = { x: 830, y: 800 };
  match.walls.push({ id: 1, ownerId: 'other-builder', inRealm: false, x: 830, y: 650, width: 20, height: 20 });

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);

  const wall = match.walls.find((candidate) => candidate.ownerId === builder.id);
  assert.deepEqual({ x: wall.x, y: wall.y, width: wall.width, height: wall.height }, { x: 830, y: 670, width: 20, height: 210 });
});

test('a wall gun shot against a vertical surface creates a horizontal wall', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');

  assert.equal(fireWallGun(match, builder.id, { x: 600, y: 580 }), true);
  const projectile = match.projectiles[0];
  projectile.position = { x: 480, y: 580 };
  projectile.velocity = { x: 900, y: 0 };
  tickMatch(match, 0.05, now + 50);

  const wall = match.walls[0];
  assert.deepEqual({ x: wall.x, y: wall.y, width: wall.width, height: wall.height }, { x: 260, y: 570, width: 250, height: 20 });
});

test('firing again replaces the wall gun owner’s previous wall', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  builder.position = { x: 830, y: 800 };

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);
  const firstWallId = match.walls[0].id;
  builder.wallGunCooldownRemaining = 0;
  builder.position = { x: 1030, y: 800 };
  assert.equal(fireWallGun(match, builder.id, { x: 1040, y: 900 }), true);
  tickMatch(match, 0.1, now + 200);

  assert.equal(match.walls.filter((wall) => wall.ownerId === builder.id).length, 1);
  assert.notEqual(match.walls.find((wall) => wall.ownerId === builder.id).id, firstWallId);
});

test('created walls block player movement after a player leaves their spawn area', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match);
  const player = match.players[0];
  player.position = { x: 270, y: 860 };
  player.input.right = true;
  match.walls.push({ id: 1, ownerId: 'builder', inRealm: false, x: 300, y: 820, width: 20, height: 60 });

  tickMatch(match, 0.1, now + 100);

  assert.equal(player.position.x, 280);
});

test('a newly created wall pushes an overlapping player out of its path', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  const other = match.players.find((player) => player.id !== builder.id);
  builder.position = { x: 830, y: 800 };
  other.position = { x: 825, y: 860 };

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);

  assert.equal(other.position.x, 810);
  assert.equal(match.walls.length, 1);
});

test('a newly created wall pushes a player away from a gap that would trap them', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  const other = match.players.find((player) => player.id !== builder.id);
  builder.position = { x: 830, y: 800 };
  other.position = { x: 825, y: 860 };
  match.walls.push({ id: 1, ownerId: 'other-builder', inRealm: false, x: 790, y: 600, width: 20, height: 280 });

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);

  assert.equal(other.position.x, 850);
  assert.equal(match.walls.length, 2);
});

test('a wall is not created when every push direction would trap a player', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  const other = match.players.find((player) => player.id !== builder.id);
  builder.position = { x: 830, y: 800 };
  other.position = { x: 825, y: 860 };
  match.walls.push(
    { id: 1, ownerId: 'left-builder', inRealm: false, x: 790, y: 600, width: 20, height: 280 },
    { id: 2, ownerId: 'right-builder', inRealm: false, x: 870, y: 600, width: 20, height: 280 }
  );

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);

  assert.equal(other.position.x, 825);
  assert.equal(match.walls.some((wall) => wall.ownerId === builder.id), false);
});

test('constructed walls decay after their configured duration', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'dash');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  builder.position = { x: 830, y: 800 };

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);

  assert.equal(match.walls.length, 1);
  const duration = CONFIG.powers['wall-gun'].wallDurationMs / 1000;
  assert.equal(publicMatch(match).walls[0].lifetimeMs, CONFIG.powers['wall-gun'].wallDurationMs);
  tickMatch(match, duration - 0.01, now + (duration + 0.09) * 1_000);
  assert.equal(match.walls.length, 1);
  tickMatch(match, 0.02, now + (duration + 0.11) * 1_000);
  assert.equal(match.walls.length, 0);
});

test('constructed walls block players in the other realm', () => {
  const match = createMatch(players(), 'crossroads');
  const now = startRound(match, 'wall-gun', 'realm-shift');
  const builder = match.players.find((player) => player.power === 'wall-gun');
  const realmPlayer = match.players.find((player) => player.id !== builder.id);
  builder.position = { x: 830, y: 800 };

  assert.equal(fireWallGun(match, builder.id, { x: 840, y: 900 }), true);
  tickMatch(match, 0.1, now + 100);
  realmPlayer.realmRemaining = 1;
  realmPlayer.position = { x: 790, y: 800 };
  realmPlayer.input.right = true;
  tickMatch(match, 0.1, now + 200);

  assert.equal(realmPlayer.position.x, 810);
  assert.equal(Object.hasOwn(publicMatch(match).walls[0], 'inRealm'), false);
});

test('landing on a jump pad launches the player upward', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const other = match.players[1];
  const pad = TEST_MAP.jumpPads.find((candidate) => candidate.x === 1090);
  player.position = { x: pad.x + 10, y: pad.y - CONFIG.player.height };
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
  other.position = { x: 2000, y: 1220 };

  tickMatch(match, 0.016, now + 16);

  assert.equal(player.position.y, pad.y - CONFIG.player.height);
  assert.equal(player.velocity.y, -pad.launchSpeed);
  assert.equal(player.grounded, false);
});

test('touching a jump pad from the side launches the player upward', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const other = match.players[1];
  const pad = TEST_MAP.jumpPads.find((candidate) => candidate.x === 790);
  player.position = {
    x: pad.x - CONFIG.player.width - 2,
    y: pad.y + pad.height - CONFIG.player.height
  };
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
  player.input.right = true;
  other.position = { x: 2000, y: 1220 };

  tickMatch(match, 0.05, now + 50);

  assert.equal(player.velocity.y, -pad.launchSpeed);
  assert.ok(player.position.y < pad.y + pad.height - CONFIG.player.height);
  assert.ok(player.jumpPadLockRemaining > 0);
});

test('the side route supports a normal jump between consecutive platforms', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const lowerPlatform = TEST_MAP.platforms.find((platform) => platform.x === 100 && platform.y === 1080);
  const upperPlatform = TEST_MAP.platforms.find((platform) => platform.x === 500 && platform.y === 920);
  player.position = {
    x: lowerPlatform.x + lowerPlatform.width - CONFIG.player.width,
    y: lowerPlatform.y - CONFIG.player.height
  };
  match.players[1].position = { x: 2000, y: 1220 };
  player.input.up = true;
  player.input.right = true;

  tickMatch(match, 0.016, now + 16);
  player.input.up = false;
  let landedOnUpperPlatform = false;
  for (let step = 2; step <= 70; step += 1) {
    tickMatch(match, 0.016, now + step * 16);
    if (player.grounded && player.position.y === upperPlatform.y - CONFIG.player.height) {
      landedOnUpperPlatform = true;
      break;
    }
  }

  assert.equal(landedOnUpperPlatform, true);
});

test('realm shift prevents tagging for two seconds and starts its cooldown', () => {
  const match = createMatch(players());
  const now = startRound(match, 'realm-shift', 'dash');
  const runner = match.players.find((player) => player.power === 'realm-shift');
  const chaser = match.players.find((player) => player.id !== runner.id);
  runner.position = { x: 500, y: 1220 };
  chaser.position = { ...runner.position };
  runner.input.realm = true;

  tickMatch(match, 0.016, now + 16);

  assert.equal(match.phase, 'playing');
  assert.equal(runner.realmRemaining, CONFIG.powers['realm-shift'].durationMs / 1000);
  assert.equal(runner.realmCooldownRemaining, CONFIG.powers['realm-shift'].cooldownMs / 1000);
  assert.equal(publicMatch(match).players.find((player) => player.id === runner.id).inRealm, true);

  runner.input.realm = false;
  tickMatch(match, 1.99, now + 2_006);
  assert.equal(match.phase, 'playing');
  tickMatch(match, 0.02, now + 2_026);
  assert.equal(match.phase, 'result');
  assert.equal(match.result.winnerId, chaser.id);
});

test('snowballs cannot hit a player in another realm', () => {
  const match = createMatch(players());
  const now = startRound(match, 'realm-shift', 'snowball');
  const shiftedPlayer = match.players.find((player) => player.power === 'realm-shift');
  const shooter = match.players.find((player) => player.power === 'snowball');
  shooter.position = { x: 100, y: 1220 };
  shiftedPlayer.position = { x: 400, y: 1220 };
  shiftedPlayer.input.realm = true;
  tickMatch(match, 0.016, now + 16);
  shiftedPlayer.input.realm = false;

  assert.equal(fireSnowball(match, shooter.id, { x: 800, y: 1230 }), true);
  tickMatch(match, 0.35, now + 366);

  assert.equal(shiftedPlayer.stunRemaining, 0);
  assert.equal(match.phase, 'playing');
  assert.equal(match.projectiles[0].inRealm, false);
});
