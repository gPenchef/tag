const CONFIG = require('../shared/game-config');

function createMatch(players) {
  const firstChaserIndex = Math.random() < 0.5 ? 0 : 1;
  const match = {
    phase: 'power-select',
    players: players.map((player, index) => ({
      ...player,
      score: 0,
      role: index === firstChaserIndex ? 'chaser' : 'runner',
      power: null,
      position: { ...CONFIG.spawns[index] },
      velocity: { x: 0, y: 0 },
      grounded: true,
      coyoteTimeRemaining: CONFIG.player.coyoteTimeMs / 1000,
      jumpHeld: false,
      extraJumpsRemaining: 0,
      dashHeld: false,
      dashRemaining: 0,
      dashCooldownRemaining: 0,
      dashDirection: 1,
      facing: index === 0 ? 1 : -1,
      input: { up: false, down: false, left: false, right: false, dash: false }
    })),
    round: 1,
    phaseEndsAt: null,
    selectionPlayerId: null,
    result: null,
    rematchVotes: new Set()
  };
  beginPowerSelection(match);
  return match;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function playerRect(player, position = player.position) {
  return { x: position.x, y: position.y, width: CONFIG.player.width, height: CONFIG.player.height };
}

function resolveHorizontalMovement(player, nextX) {
  const verticallyOverlapping = CONFIG.platforms.filter((platform) =>
    player.position.y + CONFIG.player.height > platform.y &&
    player.position.y < platform.y + platform.height
  );

  if (player.velocity.x > 0) {
    const currentRight = player.position.x + CONFIG.player.width;
    const nextRight = nextX + CONFIG.player.width;
    const wall = verticallyOverlapping
      .filter((platform) => currentRight <= platform.x && nextRight >= platform.x)
      .sort((first, second) => first.x - second.x)[0];
    if (wall) {
      player.velocity.x = 0;
      return wall.x - CONFIG.player.width;
    }
  }

  if (player.velocity.x < 0) {
    const currentLeft = player.position.x;
    const wall = verticallyOverlapping
      .filter((platform) => currentLeft >= platform.x + platform.width && nextX <= platform.x + platform.width)
      .sort((first, second) => second.x + second.width - (first.x + first.width))[0];
    if (wall) {
      player.velocity.x = 0;
      return wall.x + wall.width;
    }
  }

  return nextX;
}

function movePlayer(player, dt) {
  const input = player.input;
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const wasGrounded = player.grounded;
  let jumped = false;
  if (direction) player.facing = direction;
  player.dashCooldownRemaining = Math.max(0, player.dashCooldownRemaining - dt);
  if (player.power === 'dash' && input.dash && !player.dashHeld && player.dashCooldownRemaining <= 0) {
    player.dashDirection = direction || player.facing;
    player.dashRemaining = CONFIG.powers.dash.durationMs / 1000;
    player.dashCooldownRemaining = CONFIG.powers.dash.cooldownMs / 1000;
  }
  player.dashHeld = input.dash;
  if (player.dashRemaining > 0) {
    player.velocity.x = player.dashDirection * CONFIG.powers.dash.speed;
    player.dashRemaining = Math.max(0, player.dashRemaining - dt);
  } else {
    player.velocity.x = direction * CONFIG.player.speed;
  }
  const canGroundJump = player.grounded || player.coyoteTimeRemaining > 0;
  const canExtraJump = player.power === 'double-jump' && !player.jumpHeld && player.extraJumpsRemaining > 0;
  if (input.up && (canGroundJump || canExtraJump)) {
    player.velocity.y = -CONFIG.player.jumpSpeed;
    player.grounded = false;
    player.coyoteTimeRemaining = 0;
    if (!canGroundJump) player.extraJumpsRemaining -= 1;
    jumped = true;
  }
  if (!input.up && player.jumpHeld && player.velocity.y < 0) {
    player.velocity.y *= CONFIG.player.jumpReleaseMultiplier;
  }
  player.jumpHeld = input.up;
  player.velocity.y = Math.min(player.velocity.y + CONFIG.player.gravity * dt, CONFIG.player.maxFallSpeed);

  const { width, height } = CONFIG.arena;
  const unclampedX = player.position.x + player.velocity.x * dt;
  const nextX = Math.max(0, Math.min(width - CONFIG.player.width, unclampedX));
  player.position.x = resolveHorizontalMovement(player, nextX);
  const previousBottom = player.position.y + CONFIG.player.height;
  let nextY = player.position.y + player.velocity.y * dt;
  player.grounded = false;
  if (player.velocity.y >= 0) {
    const landing = CONFIG.platforms.find((platform) =>
      player.position.x + CONFIG.player.width > platform.x && player.position.x < platform.x + platform.width &&
      previousBottom <= platform.y && nextY + CONFIG.player.height >= platform.y
    );
    if (landing) {
      nextY = landing.y - CONFIG.player.height;
      player.velocity.y = 0;
      player.grounded = true;
    }
  } else {
    const ceiling = CONFIG.platforms.find((platform) =>
      player.position.x + CONFIG.player.width > platform.x && player.position.x < platform.x + platform.width &&
      player.position.y >= platform.y + platform.height && nextY <= platform.y + platform.height
    );
    if (ceiling) {
      nextY = ceiling.y + ceiling.height;
      player.velocity.y = 0;
    }
  }
  player.position.y = Math.max(0, Math.min(height - CONFIG.player.height, nextY));
  if (player.position.y >= height - CONFIG.player.height) {
    player.velocity.y = 0;
    player.grounded = true;
  }
  if (player.grounded) {
    player.coyoteTimeRemaining = CONFIG.player.coyoteTimeMs / 1000;
    player.extraJumpsRemaining = player.power === 'double-jump' ? 1 : 0;
  }
  else if (wasGrounded && !jumped) player.coyoteTimeRemaining = CONFIG.player.coyoteTimeMs / 1000;
  else if (!jumped) player.coyoteTimeRemaining = Math.max(0, player.coyoteTimeRemaining - dt);
}

function resetPlayerForRound(player, index) {
  player.position = { ...CONFIG.spawns[index] };
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
  player.coyoteTimeRemaining = CONFIG.player.coyoteTimeMs / 1000;
  player.jumpHeld = false;
  player.extraJumpsRemaining = player.power === 'double-jump' ? 1 : 0;
  player.dashHeld = false;
  player.dashRemaining = 0;
  player.dashCooldownRemaining = 0;
  player.dashDirection = index === 0 ? 1 : -1;
  player.facing = index === 0 ? 1 : -1;
  player.input = { up: false, down: false, left: false, right: false, dash: false };
}

function beginPowerSelection(match) {
  match.players.forEach((player, index) => {
    player.power = null;
    resetPlayerForRound(player, index);
  });
  match.phase = 'power-select';
  match.phaseEndsAt = null;
  match.selectionPlayerId = match.players.find((player) => player.role === 'runner').id;
  match.result = null;
}

function prepareRound(match, now = Date.now()) {
  match.players.forEach(resetPlayerForRound);
  match.phase = 'countdown';
  match.phaseEndsAt = now + CONFIG.round.countdownMs;
  match.selectionPlayerId = null;
  match.result = null;
}

function selectPower(match, playerId, powerId, now = Date.now()) {
  if (match.phase !== 'power-select' || match.selectionPlayerId !== playerId) return false;
  if (typeof powerId !== 'string' || !Object.prototype.hasOwnProperty.call(CONFIG.powers, powerId)) return false;
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  player.power = powerId;
  if (player.role === 'runner') {
    match.selectionPlayerId = match.players.find((candidate) => candidate.role === 'chaser').id;
  } else {
    prepareRound(match, now);
  }
  return true;
}

function finishRound(match, winner, reason) {
  winner.score += 1;
  match.phase = 'result';
  match.phaseEndsAt = Date.now() + CONFIG.round.resultMs;
  match.result = { winnerId: winner.id, winnerName: winner.name, reason };
}

function tickMatch(match, dt, now = Date.now()) {
  if (match.phase === 'countdown' && now >= match.phaseEndsAt) {
    match.phase = 'playing';
    match.phaseEndsAt = now + CONFIG.round.durationMs;
    return;
  }
  if (match.phase === 'playing') {
    match.players.forEach((player) => movePlayer(player, dt));
    const [first, second] = match.players;
    if (rectsOverlap(playerRect(first), playerRect(second))) {
      finishRound(match, match.players.find((player) => player.role === 'chaser'), 'tag');
      return;
    }
    if (now >= match.phaseEndsAt) finishRound(match, match.players.find((player) => player.role === 'runner'), 'timeout');
    return;
  }
  if (match.phase === 'result' && now >= match.phaseEndsAt) {
    if (match.players.some((player) => player.score >= CONFIG.round.winsToMatch)) {
      match.phase = 'match-over';
      return;
    }
    match.round += 1;
    match.players.forEach((player) => { player.role = player.role === 'chaser' ? 'runner' : 'chaser'; });
    beginPowerSelection(match);
  }
}

function publicMatch(match) {
  return {
    phase: match.phase,
    round: match.round,
    phaseEndsAt: match.phaseEndsAt,
    selectionPlayerId: match.selectionPlayerId,
    result: match.result,
    rematchVotes: [...match.rematchVotes],
    players: match.players.map(({ id, name, score, role, power, position, dashCooldownRemaining }) => ({
      id,
      name,
      score,
      role,
      power,
      position,
      dashCooldownMs: Math.ceil(dashCooldownRemaining * 1000)
    }))
  };
}

module.exports = { createMatch, selectPower, tickMatch, publicMatch };
