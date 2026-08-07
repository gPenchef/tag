const CONFIG = require('../shared/game-config');

function getMap(mapId) {
  return CONFIG.maps[mapId] || CONFIG.maps[CONFIG.defaultMapId];
}

function createMatch(players, mapId = CONFIG.defaultMapId) {
  const selectedMapId = Object.prototype.hasOwnProperty.call(CONFIG.maps, mapId) ? mapId : CONFIG.defaultMapId;
  const map = getMap(selectedMapId);
  const firstChaserIndex = Math.random() < 0.5 ? 0 : 1;
  const match = {
    mapId: selectedMapId,
    phase: 'power-select',
    players: players.map((player, index) => ({
      ...player,
      score: 0,
      role: index === firstChaserIndex ? 'chaser' : 'runner',
      power: null,
      position: { ...map.spawns[index] },
      velocity: { x: 0, y: 0 },
      grounded: true,
      coyoteTimeRemaining: CONFIG.player.coyoteTimeMs / 1000,
      jumpHeld: false,
      extraJumpsRemaining: 0,
      dashHeld: false,
      dashRemaining: 0,
      dashCooldownRemaining: 0,
      dashDirection: 1,
      snowballCooldownRemaining: 0,
      stunRemaining: 0,
      jumpPadLockRemaining: 0,
      realmHeld: false,
      realmRemaining: 0,
      realmCooldownRemaining: 0,
      facing: index === 0 ? 1 : -1,
      input: { up: false, down: false, left: false, right: false, dash: false, realm: false }
    })),
    projectiles: [],
    nextProjectileId: 1,
    round: 1,
    phaseEndsAt: null,
    selectionPlayerId: null,
    result: null,
    restartRequestPlayerId: null,
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

function segmentRectIntersection(start, end, rect, padding = 0) {
  const minimumX = rect.x - padding;
  const maximumX = rect.x + rect.width + padding;
  const minimumY = rect.y - padding;
  const maximumY = rect.y + rect.height + padding;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let nearTime = 0;
  let farTime = 1;

  for (const [startValue, delta, minimum, maximum] of [
    [start.x, deltaX, minimumX, maximumX],
    [start.y, deltaY, minimumY, maximumY]
  ]) {
    if (Math.abs(delta) < Number.EPSILON) {
      if (startValue < minimum || startValue > maximum) return null;
      continue;
    }
    const firstTime = (minimum - startValue) / delta;
    const secondTime = (maximum - startValue) / delta;
    nearTime = Math.max(nearTime, Math.min(firstTime, secondTime));
    farTime = Math.min(farTime, Math.max(firstTime, secondTime));
    if (nearTime > farTime) return null;
  }

  return nearTime;
}

function resolveHorizontalMovement(player, nextX, map) {
  const verticallyOverlapping = map.platforms.filter((platform) =>
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

function launchPlayerFromPad(player, jumpPad) {
  player.velocity.y = -jumpPad.launchSpeed;
  player.grounded = false;
  player.coyoteTimeRemaining = 0;
  player.jumpPadLockRemaining = CONFIG.jumpPadSettings.retriggerLockMs / 1000;
}

function movePlayer(player, dt, map) {
  const input = player.input;
  const stunned = player.stunRemaining > 0;
  const direction = stunned ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const wasGrounded = player.grounded;
  let jumped = false;
  player.stunRemaining = Math.max(0, player.stunRemaining - dt);
  player.jumpPadLockRemaining = Math.max(0, player.jumpPadLockRemaining - dt);
  if (direction) player.facing = direction;
  player.dashCooldownRemaining = Math.max(0, player.dashCooldownRemaining - dt);
  player.snowballCooldownRemaining = Math.max(0, player.snowballCooldownRemaining - dt);
  player.realmCooldownRemaining = Math.max(0, player.realmCooldownRemaining - dt);
  player.realmRemaining = Math.max(0, player.realmRemaining - dt);
  if (!stunned && player.power === 'dash' && input.dash && !player.dashHeld && player.dashCooldownRemaining <= 0) {
    player.dashDirection = direction || player.facing;
    player.dashRemaining = CONFIG.powers.dash.durationMs / 1000;
    player.dashCooldownRemaining = CONFIG.powers.dash.cooldownMs / 1000;
  }
  player.dashHeld = input.dash;
  if (!stunned && player.power === 'realm-shift' && input.realm && !player.realmHeld && player.realmCooldownRemaining <= 0) {
    player.realmRemaining = CONFIG.powers['realm-shift'].durationMs / 1000;
    player.realmCooldownRemaining = CONFIG.powers['realm-shift'].cooldownMs / 1000;
  }
  player.realmHeld = input.realm;
  if (stunned) {
    player.dashRemaining = 0;
    player.velocity.x = 0;
  } else if (player.dashRemaining > 0) {
    player.velocity.x = player.dashDirection * CONFIG.powers.dash.speed;
    player.dashRemaining = Math.max(0, player.dashRemaining - dt);
  } else {
    player.velocity.x = direction * CONFIG.player.speed;
  }
  const canGroundJump = player.grounded || player.coyoteTimeRemaining > 0;
  const canExtraJump = player.power === 'double-jump' && !player.jumpHeld && player.extraJumpsRemaining > 0;
  if (!stunned && input.up && (canGroundJump || canExtraJump)) {
    player.velocity.y = -CONFIG.player.jumpSpeed;
    player.grounded = false;
    player.coyoteTimeRemaining = 0;
    if (!canGroundJump) player.extraJumpsRemaining -= 1;
    jumped = true;
  }
  player.jumpHeld = input.up;
  player.velocity.y = Math.min(player.velocity.y + CONFIG.player.gravity * dt, CONFIG.player.maxFallSpeed);

  const { width, height } = map.arena;
  const previousX = player.position.x;
  const unclampedX = player.position.x + player.velocity.x * dt;
  const nextX = Math.max(0, Math.min(width - CONFIG.player.width, unclampedX));
  player.position.x = resolveHorizontalMovement(player, nextX, map);
  const horizontalSweepLeft = Math.min(previousX, player.position.x);
  const horizontalSweepRight = Math.max(previousX + CONFIG.player.width, player.position.x + CONFIG.player.width);
  const sideJumpPad = player.jumpPadLockRemaining <= 0 && map.jumpPads.find((pad) =>
    horizontalSweepRight > pad.x && horizontalSweepLeft < pad.x + pad.width &&
    player.position.y + CONFIG.player.height > pad.y && player.position.y < pad.y + pad.height
  );
  if (sideJumpPad) launchPlayerFromPad(player, sideJumpPad);
  const previousBottom = player.position.y + CONFIG.player.height;
  let nextY = player.position.y + player.velocity.y * dt;
  player.grounded = false;
  if (player.velocity.y >= 0) {
    const jumpPad = player.jumpPadLockRemaining <= 0 && map.jumpPads.find((pad) =>
      player.position.x + CONFIG.player.width > pad.x && player.position.x < pad.x + pad.width &&
      previousBottom <= pad.y && nextY + CONFIG.player.height >= pad.y
    );
    const landing = map.platforms.find((platform) =>
      player.position.x + CONFIG.player.width > platform.x && player.position.x < platform.x + platform.width &&
      previousBottom <= platform.y && nextY + CONFIG.player.height >= platform.y
    );
    if (jumpPad && (!landing || jumpPad.y <= landing.y)) {
      nextY = jumpPad.y - CONFIG.player.height;
      launchPlayerFromPad(player, jumpPad);
    } else if (landing) {
      nextY = landing.y - CONFIG.player.height;
      player.velocity.y = 0;
      player.grounded = true;
    }
  } else {
    const ceiling = map.platforms.find((platform) =>
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

function resetPlayerForRound(player, index, map) {
  player.position = { ...map.spawns[index] };
  player.velocity = { x: 0, y: 0 };
  player.grounded = true;
  player.coyoteTimeRemaining = CONFIG.player.coyoteTimeMs / 1000;
  player.jumpHeld = false;
  player.extraJumpsRemaining = player.power === 'double-jump' ? 1 : 0;
  player.dashHeld = false;
  player.dashRemaining = 0;
  player.dashCooldownRemaining = 0;
  player.dashDirection = index === 0 ? 1 : -1;
  player.snowballCooldownRemaining = 0;
  player.stunRemaining = 0;
  player.jumpPadLockRemaining = 0;
  player.realmHeld = false;
  player.realmRemaining = 0;
  player.realmCooldownRemaining = 0;
  player.facing = index === 0 ? 1 : -1;
  player.input = { up: false, down: false, left: false, right: false, dash: false, realm: false };
}

function beginPowerSelection(match) {
  const map = getMap(match.mapId);
  match.players.forEach((player, index) => {
    player.power = null;
    resetPlayerForRound(player, index, map);
  });
  match.phase = 'power-select';
  match.projectiles = [];
  match.phaseEndsAt = null;
  match.selectionPlayerId = match.players.find((player) => player.role === 'runner').id;
  match.result = null;
}

function prepareRound(match, now = Date.now()) {
  const map = getMap(match.mapId);
  match.players.forEach((player, index) => resetPlayerForRound(player, index, map));
  match.projectiles = [];
  match.phase = 'countdown';
  match.phaseEndsAt = now + CONFIG.round.countdownMs;
  match.selectionPlayerId = null;
  match.result = null;
  match.restartRequestPlayerId = null;
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

function fireSnowball(match, playerId, target) {
  if (match.phase !== 'playing' || !target || typeof target !== 'object') return false;
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
  const map = getMap(match.mapId);
  if (target.x < 0 || target.x > map.arena.width || target.y < 0 || target.y > map.arena.height) return false;
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player || player.power !== 'snowball' || player.snowballCooldownRemaining > 0 || player.stunRemaining > 0) return false;

  const origin = {
    x: player.position.x + CONFIG.player.width / 2,
    y: player.position.y + CONFIG.player.height / 2
  };
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 0.001) return false;

  match.projectiles.push({
    id: match.nextProjectileId++,
    ownerId: player.id,
    position: origin,
    velocity: {
      x: deltaX / distance * CONFIG.powers.snowball.projectileSpeed,
      y: deltaY / distance * CONFIG.powers.snowball.projectileSpeed
    },
    inRealm: player.realmRemaining > 0,
    lifetimeRemaining: CONFIG.powers.snowball.projectileLifetimeMs / 1000
  });
  player.snowballCooldownRemaining = CONFIG.powers.snowball.cooldownMs / 1000;
  return true;
}

function requestRoundRestart(match, playerId) {
  if (match.phase !== 'playing' || match.restartRequestPlayerId) return false;
  if (!match.players.some((player) => player.id === playerId)) return false;
  match.restartRequestPlayerId = playerId;
  return true;
}

function respondToRoundRestart(match, playerId, accepted, now = Date.now()) {
  if (match.phase !== 'playing' || !match.restartRequestPlayerId || match.restartRequestPlayerId === playerId) return false;
  if (!match.players.some((player) => player.id === playerId) || typeof accepted !== 'boolean') return false;
  if (accepted) prepareRound(match, now);
  else match.restartRequestPlayerId = null;
  return true;
}

function updateProjectiles(match, dt, map) {
  const radius = CONFIG.powers.snowball.projectileRadius;
  match.projectiles = match.projectiles.filter((projectile) => {
    const nextPosition = {
      x: projectile.position.x + projectile.velocity.x * dt,
      y: projectile.position.y + projectile.velocity.y * dt
    };
    const target = match.players.find((player) =>
      player.id !== projectile.ownerId && (player.realmRemaining > 0) === projectile.inRealm
    );
    const targetHitTime = target
      ? segmentRectIntersection(projectile.position, nextPosition, playerRect(target), radius)
      : null;
    let platformHitTime = null;
    map.platforms.forEach((platform) => {
      const hitTime = segmentRectIntersection(projectile.position, nextPosition, platform, radius);
      if (hitTime !== null && (platformHitTime === null || hitTime < platformHitTime)) platformHitTime = hitTime;
    });

    if (targetHitTime !== null && (platformHitTime === null || targetHitTime <= platformHitTime)) {
      target.stunRemaining = Math.max(target.stunRemaining, CONFIG.powers.snowball.stunMs / 1000);
      target.dashRemaining = 0;
      target.velocity.x = 0;
      return false;
    }
    if (platformHitTime !== null) return false;

    projectile.position = nextPosition;
    projectile.lifetimeRemaining -= dt;
    return projectile.lifetimeRemaining > 0 &&
      nextPosition.x >= -radius && nextPosition.x <= map.arena.width + radius &&
      nextPosition.y >= -radius && nextPosition.y <= map.arena.height + radius;
  });
}

function finishRound(match, winner, reason) {
  winner.score += 1;
  match.phase = 'result';
  match.phaseEndsAt = Date.now() + CONFIG.round.resultMs;
  match.result = { winnerId: winner.id, winnerName: winner.name, reason };
  match.projectiles = [];
  match.restartRequestPlayerId = null;
}

function tickMatch(match, dt, now = Date.now()) {
  if (match.phase === 'countdown' && now >= match.phaseEndsAt) {
    match.phase = 'playing';
    match.phaseEndsAt = now + CONFIG.round.durationMs;
    return;
  }
  if (match.phase === 'playing') {
    const map = getMap(match.mapId);
    match.players.forEach((player) => movePlayer(player, dt, map));
    updateProjectiles(match, dt, map);
    const [first, second] = match.players;
    const playersShareRealm = (first.realmRemaining > 0) === (second.realmRemaining > 0);
    if (playersShareRealm && rectsOverlap(playerRect(first), playerRect(second))) {
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
    mapId: match.mapId,
    phase: match.phase,
    round: match.round,
    phaseEndsAt: match.phaseEndsAt,
    selectionPlayerId: match.selectionPlayerId,
    result: match.result,
    restartRequestPlayerId: match.restartRequestPlayerId,
    rematchVotes: [...match.rematchVotes],
    players: match.players.map(({ id, name, score, role, power, position, grounded, extraJumpsRemaining, dashCooldownRemaining, snowballCooldownRemaining, stunRemaining, realmRemaining, realmCooldownRemaining }) => ({
      id,
      name,
      score,
      role,
      power,
      position,
      grounded,
      extraJumpsRemaining,
      dashCooldownMs: Math.ceil(dashCooldownRemaining * 1000),
      snowballCooldownMs: Math.ceil(snowballCooldownRemaining * 1000),
      stunnedMs: Math.ceil(stunRemaining * 1000),
      inRealm: realmRemaining > 0,
      realmRemainingMs: Math.ceil(realmRemaining * 1000),
      realmCooldownMs: Math.ceil(realmCooldownRemaining * 1000)
    })),
    projectiles: match.projectiles.map(({ id, ownerId, position, inRealm }) => ({ id, ownerId, position, inRealm }))
  };
}

module.exports = {
  createMatch,
  selectPower,
  fireSnowball,
  requestRoundRestart,
  respondToRoundRestart,
  tickMatch,
  publicMatch
};
