const test = require('node:test');
const assert = require('node:assert/strict');
const { createMatch, selectPower, tickMatch, publicMatch } = require('../server/game');
const CONFIG = require('../shared/game-config');

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

test('the expanded map keeps all geometry and spawns inside the arena', () => {
  assert.equal(CONFIG.arena.width, 2250);
  assert.equal(CONFIG.arena.height, 1280);
  assert.ok(CONFIG.platforms.length > 26);
  assert.equal(CONFIG.camera.deadZoneX, 135);
  assert.equal(CONFIG.camera.minViewWidth, 700);
  assert.equal(CONFIG.camera.paddingX, 220);
  assert.equal(CONFIG.camera.zoomOutDeceleration, 900);
  CONFIG.platforms.forEach((platform) => {
    assert.ok(platform.x >= 0 && platform.y >= 0);
    assert.ok(platform.x + platform.width <= CONFIG.arena.width);
    assert.ok(platform.y + platform.height <= CONFIG.arena.height);
  });
  CONFIG.spawns.forEach((spawn) => {
    assert.ok(spawn.x >= 0 && spawn.x + CONFIG.player.width <= CONFIG.arena.width);
    assert.ok(spawn.y >= 0 && spawn.y + CONFIG.player.height <= CONFIG.arena.height);
  });
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
  assert.ok(player.position.y < CONFIG.spawns[0].y);
  assert.ok(player.velocity.y < 0);
});

test('releasing jump early produces a shorter jump', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const [held, released] = match.players;
  held.input.up = true;
  released.input.up = true;
  tickMatch(match, 0.016, now + 16);

  released.input.up = false;
  tickMatch(match, 0.016, now + 32);

  assert.ok(released.velocity.y > held.velocity.y);
  assert.ok(released.position.y > held.position.y);
  const velocityAfterRelease = released.velocity.y;
  tickMatch(match, 0.016, now + 48);
  assert.ok(Math.abs(released.velocity.y - velocityAfterRelease - CONFIG.player.gravity * 0.016) < 0.001);
});

test('players stop when jumping into the underside of a platform', () => {
  const match = createMatch(players());
  const now = startRound(match);
  const player = match.players[0];
  const platform = CONFIG.platforms.find((candidate) => candidate.x === 195 * 1.25 && candidate.y === 205 + 160);
  player.position = { x: 220, y: platform.y + platform.height + 3 };
  player.velocity = { x: 0, y: -500 };
  player.grounded = false;

  tickMatch(match, 0.1, now + 100);

  assert.equal(player.position.y, platform.y + platform.height);
  assert.equal(player.velocity.y, 0);
  assert.equal(player.grounded, false);
});

test('players cannot move through either side of a platform', () => {
  const platform = CONFIG.platforms.find((candidate) => candidate.x === 350 * 1.25 && candidate.y === 325 + 160);

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
  const platform = CONFIG.platforms.find((candidate) => candidate.x === 75 * 1.25 && candidate.y === 400 + 160);
  player.position = { x: platform.x + platform.width - 15, y: platform.y - CONFIG.player.height };
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
  player.input.up = false;
  tickMatch(match, 0.01, now + 58);
  const velocityBeforeThirdPress = player.velocity.y;
  player.input.up = true;
  tickMatch(match, 0.01, now + 68);
  assert.equal(player.extraJumpsRemaining, 0);
  assert.ok(Math.abs(player.velocity.y - velocityBeforeThirdPress - CONFIG.player.gravity * 0.01) < 0.001);
});
