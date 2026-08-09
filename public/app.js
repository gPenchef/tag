const socket = io();
const config = window.GAME_CONFIG;
const $ = (selector) => document.querySelector(selector);
const screens = {
  lobby: $("#lobby-screen"),
  waiting: $("#waiting-screen"),
  game: $("#game-screen"),
};
const canvas = $("#game");
const ctx = canvas.getContext("2d");
let state = null;
let myId = null;
let sentInput = {};
let exitMenuOpen = false;
let spectating = false;
let selectedMapId = config.defaultMapId;

// Persistent maps to hold smoothed positions across server state updates
const playerRenderState = new Map();
const projectileRenderState = new Map();

const camera = {
  x: 0,
  y: 0,
  width: config.maps[config.defaultMapId].arena.width,
  height: config.maps[config.defaultMapId].arena.height,
  zoomOutVelocity: 0,
  lastUpdatedAt: 0,
  initialized: false,
};
const input = {
  up: false,
  down: false,
  left: false,
  right: false,
  dash: false,
  realm: false,
  ability: false,
};

function show(name) {
  Object.entries(screens).forEach(([key, screen]) =>
    screen.classList.toggle("hidden", key !== name),
  );
  document.body.classList.toggle("game-active", name === "game");
}
function nameValue() {
  return $("#name").value.trim();
}
function clearError() {
  $("#lobby-error").textContent = "";
}
function sendLobby(event, extra = {}) {
  clearError();
  socket.emit(event, { name: nameValue(), ...extra });
}
function mapPreview(map) {
  const rectangles = map.platforms
    .map(
      (platform) =>
        `<rect x="${platform.x}" y="${platform.y}" width="${platform.width}" height="${platform.height}" fill="#343d4c" />`,
    )
    .join("");
  const pads = map.jumpPads
    .map(
      (pad) =>
        `<rect x="${pad.x}" y="${pad.y}" width="${pad.width}" height="${pad.height}" fill="#a3e635" />`,
    )
    .join("");
  const spawns = map.spawns
    .map(
      (spawn, index) =>
        `<rect x="${spawn.x}" y="${spawn.y}" width="${config.player.width}" height="${config.player.height}" fill="${index ? "#fb7185" : "#67e8f9"}" />`,
    )
    .join("");
  return `<svg class="map-preview" viewBox="0 0 ${map.arena.width} ${map.arena.height}" role="img" aria-label="${escapeHtml(map.name)} map preview"><rect width="${map.arena.width}" height="${map.arena.height}" fill="${escapeHtml(map.theme.skyBottom)}" /><rect width="${map.arena.width}" height="${map.arena.height}" fill="${escapeHtml(map.theme.skyTop)}" opacity=".45" />${rectangles}${pads}${spawns}</svg>`;
}
function renderMapPicker() {
  $("#map-list").innerHTML = Object.entries(config.maps)
    .map(
      ([mapId, map]) =>
        `<button type="button" class="map-card${mapId === selectedMapId ? " selected" : ""}" data-map-id="${escapeHtml(mapId)}" role="radio" aria-checked="${mapId === selectedMapId}">${mapPreview(map)}<span class="map-card-name">${escapeHtml(map.name)}</span><span class="map-card-description">${escapeHtml(map.description)}</span></button>`,
    )
    .join("");
  document.querySelectorAll(".map-card").forEach((card) => {
    card.onclick = () => {
      selectedMapId = card.dataset.mapId;
      renderMapPicker();
    };
  });
}
renderMapPicker();
$("#create").onclick = () =>
  sendLobby("lobby:create", { mapId: selectedMapId });
$("#join").onclick = () => sendLobby("lobby:join", { code: $("#code").value });
$("#spectate").onclick = () =>
  sendLobby("lobby:spectate", { code: $("#code").value });
$("#code").addEventListener("input", () => {
  $("#code").value = $("#code").value.toUpperCase();
});
function myPlayer() {
  return state?.players.find((player) => player.id === myId);
}
function leaveLobby(confirmForfeit = true) {
  const activeMatch =
    !screens.game.classList.contains("hidden") && state?.phase !== "match-over";
  if (
    confirmForfeit &&
    activeMatch &&
    !spectating &&
    !confirm("Exit this match? Your opponent will win by forfeit.")
  )
    return;
  socket.emit("lobby:leave");
}
function clearInput() {
  Object.keys(input).forEach((key) => (input[key] = false));
  sentInput = {};
  socket.emit("input:update", input);
}
function hasIncomingRestartRequest() {
  return (
    myPlayer() &&
    state?.restartRequestPlayerId &&
    state.restartRequestPlayerId !== myId
  );
}
function openExitMenu() {
  if (!state) return;
  exitMenuOpen = true;
  clearInput();
  render();
}
function closeExitMenu() {
  exitMenuOpen = false;
  render();
}
$("#leave").onclick = leaveLobby;

socket.on("connect", () => {
  myId = socket.id;
});
socket.on("lobby:error", (message) => {
  $("#lobby-error").textContent = message;
});
socket.on("lobby:left", () => {
  state = null;
  spectating = false;
  camera.initialized = false;
  camera.lastUpdatedAt = 0;
  exitMenuOpen = false;
  clearInput();
  show("lobby");
});
socket.on("lobby:closed", () => {
  state = null;
  spectating = false;
  camera.initialized = false;
  camera.lastUpdatedAt = 0;
  exitMenuOpen = false;
  clearInput();
  show("lobby");
  $("#lobby-error").textContent = "The lobby closed because all players left.";
});
socket.on("lobby:state", (lobby) => {
  const spectators = lobby.spectators || [];
  spectating = spectators.some((spectator) => spectator.id === myId);
  $("#lobby-code").textContent = lobby.code;
  $("#waiting-map").textContent =
    `Map: ${config.maps[lobby.mapId]?.name || "Unknown"}`;
  $("#waiting-players").innerHTML = lobby.players
    .map(
      (player, index) =>
        `<div>${index + 1}. ${escapeHtml(player.name)}${player.id === myId ? " (you)" : ""}</div>`,
    )
    .join("");
  $("#waiting-spectators").innerHTML = spectators
    .map(
      (spectator) =>
        `<div>${escapeHtml(spectator.name)}${spectator.id === myId ? " (you)" : ""}</div>`,
    )
    .join("");
  $("#waiting-spectators-wrap").classList.toggle(
    "hidden",
    spectators.length === 0,
  );
  if (!lobby.hasMatch) show("waiting");
  else show("game");
});
socket.on("game:state", (nextState) => {
  if (state?.mapId !== nextState.mapId) camera.initialized = false;
  state = nextState;
  if (state.phase !== "playing") exitMenuOpen = false;
  show("game");
});

function escapeHtml(text) {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}
function renderHud() {
  if (!state) return;
  $("#scoreboard").innerHTML = state.players
    .map((player) => {
      const power = player.power
        ? config.powers[player.power]?.name
        : "Choosing...";
      const cooldownMs =
        player.power === "dash"
          ? player.dashCooldownMs
          : player.power === "snowball"
            ? player.snowballCooldownMs
            : player.power === "wall-gun"
              ? player.wallGunCooldownMs
              : player.power === "wall-drill"
                ? player.wallDrillCooldownMs
                : player.power === "realm-shift"
                  ? player.realmCooldownMs
                  : 0;
      const cooldown =
        player.id === myId && cooldownMs > 0
          ? ` · ${Math.ceil(cooldownMs / 100) / 10}s`
          : "";
      return `<div class="score"><span>${escapeHtml(player.name)}${player.id === myId ? " · YOU" : ""}</span><b>${player.score}</b><em>${escapeHtml(power)}${cooldown}</em></div>`;
    })
    .join("");
  $("#spectator-badge").classList.toggle("hidden", !spectating);
  const me = myPlayer();
  canvas.style.cursor =
    state.phase === "playing" && ["snowball", "wall-gun"].includes(me?.power)
      ? "crosshair"
      : "default";
}
function setInput(event, active) {
  const keyMap = {
    Space: "up",
    ArrowUp: "up",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    ShiftLeft: "dash",
    ShiftRight: "dash",
    KeyE: "ability",
  };
  const key = keyMap[event.code];
  if (
    !key ||
    !myPlayer() ||
    screens.game.classList.contains("hidden") ||
    (active && (exitMenuOpen || hasIncomingRestartRequest()))
  )
    return;
  event.preventDefault();
  input[key] = active;
  const signature = JSON.stringify(input);
  if (signature !== sentInput.signature) {
    sentInput.signature = signature;
    socket.emit("input:update", input);
  }
}
addEventListener("keydown", (event) => {
  if (
    event.code === "Escape" &&
    !event.repeat &&
    !screens.game.classList.contains("hidden") &&
    state
  ) {
    event.preventDefault();
    if (exitMenuOpen) closeExitMenu();
    else openExitMenu();
    return;
  }
  setInput(event, true);
});
addEventListener("keyup", (event) => setInput(event, false));
addEventListener("blur", clearInput);
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state?.phase !== "playing") return;
  const me = state.players.find((player) => player.id === myId);
  const gunCooldownMs =
    me?.power === "snowball"
      ? me.snowballCooldownMs
      : me?.power === "wall-gun"
        ? me.wallGunCooldownMs
        : null;
  if (gunCooldownMs === null || gunCooldownMs > 0 || me.stunnedMs > 0) return;
  const bounds = canvas.getBoundingClientRect();
  const canvasX = ((event.clientX - bounds.left) * canvas.width) / bounds.width;
  const canvasY =
    ((event.clientY - bounds.top) * canvas.height) / bounds.height;
  socket.emit("power:use", {
    target: {
      x: camera.x + (canvasX / canvas.width) * camera.width,
      y: camera.y + (canvasY / canvas.height) * camera.height,
    },
  });
});

function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function clampCameraPosition(position, viewSize, arenaSize) {
  if (viewSize >= arenaSize) return (arenaSize - viewSize) / 2;
  return clamp(position, 0, arenaSize - viewSize);
}
function activeMap() {
  return config.maps[state?.mapId] || config.maps[config.defaultMapId];
}
function visiblePlayers() {
  const me = state.players.find((player) => player.id === myId);
  if (!me) return state.players;
  return state.players.filter((player) => player.inRealm === me.inRealm);
}
function realmsAreSeparated() {
  return (
    state.players.length > 1 &&
    state.players.some((player) => player.inRealm !== state.players[0].inRealm)
  );
}

function updateCamera() {
  const map = activeMap();
  const now = performance.now();

  const dt = camera.lastUpdatedAt
    ? Math.min((now - camera.lastUpdatedAt) / 1000, 0.1)
    : 0;
  camera.lastUpdatedAt = now;

  const aspect = canvas.width / canvas.height;
  const players = visiblePlayers();

  if (!players.length) {
    if (!camera.initialized) {
      camera.width = map.arena.width;
      camera.height = map.arena.width / aspect;
      camera.x = clampCameraPosition(0, camera.width, map.arena.width);
      camera.y = clampCameraPosition(0, camera.height, map.arena.height);
      camera.zoomOutVelocity = 0;
      camera.initialized = true;
    }
    return camera;
  }

  const left = Math.min(
    ...players.map((player) => player.renderX ?? player.position.x),
  );
  const right = Math.max(
    ...players.map(
      (player) => (player.renderX ?? player.position.x) + config.player.width,
    ),
  );
  const top = Math.min(
    ...players.map((player) => player.renderY ?? player.position.y),
  );
  const bottom = Math.max(
    ...players.map(
      (player) => (player.renderY ?? player.position.y) + config.player.height,
    ),
  );

  const spanX = right - left;
  const spanY = bottom - top;

  const targetCenterX = (left + right) / 2;
  const targetCenterY = (top + bottom) / 2;

  const realmSeparated = realmsAreSeparated();

  const desiredWidth = realmSeparated
    ? map.arena.width
    : clamp(
        Math.max(
          config.camera.minViewWidth,
          spanX + config.camera.paddingX * 2,
          (spanY + config.camera.paddingY * 2) * aspect,
        ),
        config.camera.minViewWidth,
        map.arena.width,
      );

  if (!camera.initialized) {
    camera.width = desiredWidth;
    camera.height = desiredWidth / aspect;
    camera.x = clampCameraPosition(
      targetCenterX - camera.width / 2,
      camera.width,
      map.arena.width,
    );
    camera.y = clampCameraPosition(
      targetCenterY - camera.height / 2,
      camera.height,
      map.arena.height,
    );
    camera.zoomOutVelocity = 0;
    camera.initialized = true;
    return camera;
  }

  const previousCenterX = camera.x + camera.width / 2;
  const previousCenterY = camera.y + camera.height / 2;

  const zoomSmoothingValue = clamp(
    config.camera.zoomInSmoothing ?? 0.12,
    0,
    0.95,
  );

  const smoothing = 1 - Math.pow(1 - zoomSmoothingValue, dt * 60);
  const zoomOutSmoothing = clamp(smoothing * (realmSeparated ? 3 : 2.25), 0, 1);
  const zoomDeadZone = Math.max(
    config.camera.deadZoneX || 0,
    desiredWidth * 0.02,
  );
  const zoomInTarget = desiredWidth + zoomDeadZone;

  if (desiredWidth > camera.width) {
    camera.width += (desiredWidth - camera.width) * zoomOutSmoothing;
  } else if (zoomInTarget < camera.width) {
    camera.width += (zoomInTarget - camera.width) * smoothing;
  }

  camera.width = clamp(
    camera.width,
    config.camera.minViewWidth,
    map.arena.width,
  );
  camera.height = camera.width / aspect;

  camera.x = previousCenterX - camera.width / 2;
  camera.y = previousCenterY - camera.height / 2;

  let currentCenterX = camera.x + camera.width / 2;
  const halfDeadX = (config.camera.deadZoneX || 0) / 2;
  const offsetX = targetCenterX - currentCenterX;

  if (offsetX > halfDeadX) {
    camera.x += (offsetX - halfDeadX) * smoothing;
  } else if (offsetX < -halfDeadX) {
    camera.x += (offsetX + halfDeadX) * smoothing;
  }

  const deadZoneY =
    config.camera.deadZoneY ?? Math.max(12, camera.height * 0.03);
  let currentCenterY = camera.y + camera.height / 2;
  const halfDeadY = deadZoneY / 2;
  const offsetY = targetCenterY - currentCenterY;

  if (offsetY > halfDeadY) {
    camera.y += (offsetY - halfDeadY) * smoothing;
  } else if (offsetY < -halfDeadY) {
    camera.y += (offsetY + halfDeadY) * smoothing;
  }

  if (camera.width < spanX) {
    camera.x = targetCenterX - camera.width / 2;
  }

  if (camera.height < spanY) {
    camera.y = targetCenterY - camera.height / 2;
  }

  camera.x = clampCameraPosition(camera.x, camera.width, map.arena.width);
  camera.y = clampCameraPosition(camera.y, camera.height, map.arena.height);

  if (camera.width >= spanX) {
    const safePaddingX = Math.min(
      config.camera.paddingX,
      (camera.width - spanX) / 2,
    );
    const minX = right + safePaddingX - camera.width;
    const maxX = left - safePaddingX;

    if (minX <= maxX) {
      camera.x = clamp(camera.x, minX, maxX);
    }
  }

  if (camera.height >= spanY) {
    const safePaddingY = Math.min(
      config.camera.paddingY,
      (camera.height - spanY) / 2,
    );
    const minY = bottom + safePaddingY - camera.height;
    const maxY = top - safePaddingY;

    if (minY <= maxY) {
      camera.y = clamp(camera.y, minY, maxY);
    }
  }

  camera.x = clampCameraPosition(camera.x, camera.width, map.arena.width);
  camera.y = clampCameraPosition(camera.y, camera.height, map.arena.height);

  return camera;
}

function render(dt = 0.016) {
  if (!state) return;

  // --- PERSISTENT NETWORK SMOOTHING ---
  if (state.players) {
    state.players.forEach((player) => {
      let rState = playerRenderState.get(player.id);
      if (!rState) {
        rState = { x: player.position.x, y: player.position.y };
        playerRenderState.set(player.id, rState);
      }

      const dx = player.position.x - rState.x;
      const dy = player.position.y - rState.y;

      // Snap if teleported (e.g. > 100 pixels) to prevent weird interpolation across the map
      if (Math.abs(dx) > 100 || Math.abs(dy) > 100) {
        rState.x = player.position.x;
        rState.y = player.position.y;
      } else {
        const smoothFactor = 1 - Math.exp(-20 * dt);
        rState.x += dx * smoothFactor;
        rState.y += dy * smoothFactor;
      }

      player.renderX = rState.x;
      player.renderY = rState.y;
    });
  }

  if (state.projectiles) {
    state.projectiles.forEach((proj) => {
      if (!proj.id) {
        proj.renderX = proj.position.x;
        proj.renderY = proj.position.y;
        return;
      }

      let rState = projectileRenderState.get(proj.id);
      if (!rState) {
        rState = { x: proj.position.x, y: proj.position.y };
        projectileRenderState.set(proj.id, rState);
      }

      const dx = proj.position.x - rState.x;
      const dy = proj.position.y - rState.y;

      if (Math.abs(dx) > 200 || Math.abs(dy) > 200) {
        rState.x = proj.position.x;
        rState.y = proj.position.y;
      } else {
        const smoothFactor = 1 - Math.exp(-30 * dt);
        rState.x += dx * smoothFactor;
        rState.y += dy * smoothFactor;
      }

      proj.renderX = rState.x;
      proj.renderY = rState.y;
    });
  }
  // -----------------------------------------

  const now = Date.now();
  const remaining = state.phaseEndsAt ? state.phaseEndsAt - now : 0;
  $("#scoreboard").innerHTML = state.players
    .map((player) => {
      const power = player.power
        ? config.powers[player.power]?.name
        : "Choosing...";
      const cooldownMs =
        player.power === "dash"
          ? player.dashCooldownMs
          : player.power === "snowball"
            ? player.snowballCooldownMs
            : player.power === "wall-gun"
              ? player.wallGunCooldownMs
              : player.power === "wall-drill"
                ? player.wallDrillCooldownMs
                : player.power === "realm-shift"
                  ? player.realmCooldownMs
                  : 0;
      const cooldown =
        player.id === myId && cooldownMs > 0
          ? ` · ${Math.ceil(cooldownMs / 100) / 10}s`
          : "";
      return `<div class="score"><span>${escapeHtml(player.name)}${player.id === myId ? " · YOU" : ""}</span><b>${player.score}</b><em>${escapeHtml(power)}${cooldown}</em></div>`;
    })
    .join("");
  $("#spectator-badge").classList.toggle("hidden", !spectating);
  const me = myPlayer();
  canvas.style.cursor =
    state.phase === "playing" &&
    (me?.power === "snowball" || me?.power === "wall-gun")
      ? "crosshair"
      : "default";
  const view = updateCamera();
  drawArena(view);
  drawProjectiles(view);
  drawPlayers(view);
  drawTimer(remaining);
  drawOverlay(remaining);
}

function applyCamera(view) {
  ctx.scale(canvas.width / view.width, canvas.height / view.height);
  ctx.translate(-view.x, -view.y);
}

function drawArena(view) {
  const map = activeMap();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const inRealm = state.players.find((player) => player.id === myId)?.inRealm;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, inRealm ? "#482061" : map.theme.skyTop);
  sky.addColorStop(1, inRealm ? "#170b24" : map.theme.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  applyCamera(view);
  ctx.fillStyle = inRealm ? "rgba(232,121,249,.11)" : "rgba(103,232,249,.08)";
  for (let x = 35; x < map.arena.width; x += 125)
    ctx.fillRect(x, 70 + (Math.floor(x / 125) % 6) * 150, 76, 2);
  map.platforms.forEach((platform) => {
    ctx.fillStyle = "#343d4c";
    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    ctx.fillStyle = inRealm ? "#e879f9" : map.theme.accent;
    ctx.fillRect(platform.x, platform.y, platform.width, 4);
  });
  (state.walls || []).forEach((wall) => {
    ctx.fillStyle = "#d97706";
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = 3;
    ctx.strokeRect(wall.x + 1.5, wall.y + 1.5, wall.width - 3, wall.height - 3);
  });
  map.jumpPads.forEach((pad) => {
    ctx.fillStyle = "#a3e635";
    ctx.fillRect(pad.x, pad.y, pad.width, pad.height);
    ctx.fillStyle = "#ecfccb";
    const arrowX = pad.x + pad.width / 2;
    ctx.beginPath();
    ctx.moveTo(arrowX, pad.y - 12);
    ctx.lineTo(arrowX - 9, pad.y - 2);
    ctx.lineTo(arrowX + 9, pad.y - 2);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function drawPlayers(view) {
  const players = visiblePlayers();
  const scaleX = canvas.width / view.width;
  const scaleY = canvas.height / view.height;

  // 1. Draw world-space elements (player cubes, drills, shadows)
  ctx.save();
  applyCamera(view);

  players.forEach((player) => {
    const px = player.renderX ?? player.position.x;
    const py = player.renderY ?? player.position.y;

    drawDrillTrail(player, px, py);

    ctx.fillStyle = player.role === "chaser" ? "#fb7185" : "#67e8f9";
    if (spectating && player.inRealm) {
      ctx.shadowColor = "#e879f9";
      ctx.shadowBlur = 18;
    } else {
      ctx.shadowBlur = 0; // Explicitly reset to prevent shadow leaking!
    }

    // Draw the player cube in world space (allows smooth subpixel movement)
    ctx.fillRect(px, py, config.player.width, config.player.height);
    ctx.shadowBlur = 0;

    drawDrillHead(player, px, py);
  });
  ctx.restore();

  // 2. Draw screen-space elements (text, power meters, stun indicators)
  players.forEach((player) => {
    const isChaser = player.role === "chaser";
    const px = player.renderX ?? player.position.x;
    const py = player.renderY ?? player.position.y;

    // Calculate crisp screen coordinates for text
    const centerX = Math.round(
      (px + config.player.width / 2 - view.x) * scaleX,
    );
    const topY = Math.round((py - view.y) * scaleY);
    const bottomY = Math.round((py + config.player.height - view.y) * scaleY);

    drawPowerMeter(player, centerX, topY - 25);

    ctx.fillStyle = "#e9edf6";
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(
      `${player.name}${player.id === myId ? " (YOU)" : ""}`,
      centerX,
      topY - 8,
    );

    const roleText = player.drill
      ? `${player.drill.phase.toUpperCase()} DRILL`
      : `${player.inRealm ? "SHADOW " : ""}${isChaser ? "TAGGER" : "RUNNER"}`;

    ctx.fillStyle = player.drill
      ? "#6ee7b7"
      : player.inRealm
        ? "#e879f9"
        : isChaser
          ? "#fb7185"
          : "#67e8f9";
    ctx.font = "bold 11px system-ui";
    ctx.fillText(roleText, centerX, bottomY + 14);

    if (player.stunnedMs > 0) {
      const stunRatio = clamp(
        player.stunnedMs / config.powers.snowball.stunMs,
        0,
        1,
      );
      const indicatorY = topY - 43;

      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(248, 250, 252, .25)";
      ctx.beginPath();
      ctx.arc(centerX, indicatorY, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(
        centerX,
        indicatorY,
        8,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * stunRatio,
      );
      ctx.stroke();
    }
  });
}

function drillPhaseProgress(drill) {
  const power = config.powers["wall-drill"];
  const recoilRatio = power.recoilDurationMs / power.drillDurationMs;
  if (drill.phase === "recoil")
    return clamp(drill.progress / recoilRatio, 0, 1);
  return clamp((drill.progress - recoilRatio) / (1 - recoilRatio), 0, 1);
}
function drawDrillTrail(player, px, py) {
  if (!player.drill || player.drill.phase !== "slam") return;
  const direction = player.drill.direction;
  const progress = drillPhaseProgress(player.drill);

  // Use the smoothed render coordinates instead of the raw server coordinates
  const centerX = px + config.player.width / 2;
  const centerY = py + config.player.height / 2;
  const trailLength = 18 + progress * 44;

  ctx.save(); // Prevent state leaking
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgba(52, 211, 153, ${0.3 + progress * 0.5})`;
  ctx.lineWidth = 14 - progress * 5;
  ctx.beginPath();
  ctx.moveTo(
    centerX - direction.x * trailLength,
    centerY - direction.y * trailLength,
  );
  ctx.lineTo(centerX - direction.x * 8, centerY - direction.y * 8);
  ctx.stroke();

  ctx.strokeStyle = "rgba(209, 250, 229, .8)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawDrillHead(player, px, py) {
  if (!player.drill) return;
  const direction = player.drill.direction;
  const progress = drillPhaseProgress(player.drill);

  // Use the smoothed render coordinates
  const centerX = px + config.player.width / 2;
  const centerY = py + config.player.height / 2;
  const angle = Math.atan2(direction.y, direction.x);
  const wobble =
    player.drill.phase === "recoil"
      ? Math.sin(performance.now() / 35) * 1.5
      : 0;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.translate(wobble, 0);
  ctx.fillStyle = "#34d399";
  ctx.strokeStyle = "#d1fae5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(7, -13);
  ctx.lineTo(27, 0);
  ctx.lineTo(7, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const spin =
    (performance.now() / 70 + progress * Math.PI * 3) % (Math.PI * 2);
  ctx.strokeStyle = "#064e3b";
  ctx.lineWidth = 2;
  for (let offset = 11; offset <= 22; offset += 5) {
    const halfHeight = (27 - offset) * 0.5;
    ctx.beginPath();
    ctx.moveTo(offset, Math.sin(spin + offset) * halfHeight);
    ctx.lineTo(offset, -Math.sin(spin + offset) * halfHeight);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPowerMeter(player, centerX, centerY) {
  const power = config.powers[player.power];
  if (!power) return;
  let readyRatio = 1;
  if (player.power === "dash") {
    readyRatio = 1 - player.dashCooldownMs / power.cooldownMs;
  } else if (player.power === "snowball") {
    readyRatio = 1 - player.snowballCooldownMs / power.cooldownMs;
  } else if (player.power === "wall-gun") {
    readyRatio = 1 - player.wallGunCooldownMs / power.cooldownMs;
  } else if (player.power === "wall-drill") {
    readyRatio = player.drill
      ? player.drill.progress
      : 1 - player.wallDrillCooldownMs / power.cooldownMs;
  } else if (player.power === "double-jump") {
    readyRatio = player.grounded || player.extraJumpsRemaining > 0 ? 1 : 0;
  } else if (player.power === "realm-shift") {
    readyRatio = 1 - player.realmCooldownMs / power.cooldownMs;
  }

  const width = 42;
  const height = 5;
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  ctx.fillStyle = "rgba(10, 13, 18, .8)";
  ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
  ctx.fillStyle = power.meterColor;
  ctx.fillRect(x, y, width * clamp(readyRatio, 0, 1), height);
}

function drawProjectiles(view) {
  ctx.save();
  applyCamera(view);
  ctx.lineWidth = 3;
  const inRealm = myPlayer()?.inRealm || false;
  (state.projectiles || [])
    .filter((projectile) => spectating || projectile.inRealm === inRealm)
    .forEach((projectile) => {
      const px = projectile.renderX ?? projectile.position.x;
      const py = projectile.renderY ?? projectile.position.y;
      const wallShot = projectile.type === "wall-gun";
      const power = config.powers[projectile.type] || config.powers.snowball;
      ctx.fillStyle = wallShot
        ? "#fbbf24"
        : projectile.inRealm
          ? "#f0abfc"
          : "#f8fafc";
      ctx.strokeStyle = wallShot
        ? "#fef3c7"
        : projectile.inRealm
          ? "#d946ef"
          : "#bae6fd";
      ctx.beginPath();
      ctx.arc(px, py, power.projectileRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  ctx.restore();
}

function drawTimer(remaining) {
  if (state.phase !== "playing") return;
  const text = formatTime(remaining);
  ctx.save();
  ctx.font = "bold 28px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 40;
  const x = canvas.width / 2;
  const y = 34;
  ctx.fillStyle = "rgba(10, 13, 18, .78)";
  ctx.fillRect(x - width / 2, y - 19, width, 38);
  ctx.strokeStyle = "rgba(103, 232, 249, .55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y - 19, width, 38);
  ctx.fillStyle = "#e9edf6";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function setOverlay(view, html) {
  const overlay = $("#overlay");
  if (overlay.dataset.view === view) return false;
  overlay.dataset.view = view;
  overlay.innerHTML = html;
  return true;
}

function drawOverlay(remaining) {
  if (state.phase === "playing" && hasIncomingRestartRequest()) {
    drawRestartRequest();
    return;
  }
  if (exitMenuOpen) {
    drawExitMenu();
    return;
  }
  if (state.phase === "power-select") {
    drawPowerSelection();
    return;
  }
  if (state.phase === "countdown") {
    const count = Math.max(1, Math.ceil(remaining / 1000));
    const role = myPlayer()?.role;
    const message = spectating
      ? `Round ${state.round} starts soon.`
      : role === "chaser"
        ? "You are the tagger. Touch the runner."
        : "You are the runner. Stay away.";
    setOverlay(
      `countdown:${count}:${role}:${spectating}`,
      `<div><h2>${count}</h2><p>${message}</p></div>`,
    );
    return;
  }
  if (state.phase === "result") {
    const mine = state.result.winnerId === myId;
    const heading = spectating
      ? "Round over"
      : mine
        ? "Round won"
        : "Round lost";
    setOverlay(
      `result:${state.round}:${state.result.winnerId}:${state.result.reason}:${spectating}`,
      `<div><h2>${heading}</h2><p>${escapeHtml(state.result.winnerName)} won by ${state.result.reason === "tag" ? "tagging" : "surviving"}.</p></div>`,
    );
    return;
  }
  if (state.phase === "match-over") {
    const winner = state.result;
    const mine = winner?.winnerId === myId;
    const votes = state.rematchVotes?.length || 0;
    const hasVoted = state.rematchVotes?.includes(myId);
    const label = hasVoted
      ? `Waiting for opponent (${votes}/2)`
      : votes
        ? `Accept rematch (${votes}/2)`
        : "Rematch";
    const rematchButton = spectating
      ? ""
      : `<button id="rematch"${hasVoted ? " disabled" : ""}>${label}</button>`;
    const changed = setOverlay(
      `match-over:${winner?.winnerId}:${winner?.reason}:${votes}:${hasVoted}:${spectating}`,
      `<div><h2>${mine ? "You win the match" : "Match over"}</h2><p>${winner ? `${escapeHtml(winner.winnerName)} won${winner.reason === "forfeit" ? " by forfeit" : ""}.` : ""}</p>${rematchButton}</div>`,
    );
    if (changed && !spectating && !hasVoted)
      $("#rematch").onclick = () => socket.emit("match:rematch");
    return;
  }
  setOverlay("playing", "");
}

function drawExitMenu() {
  if (spectating) {
    const changed = setOverlay(
      "exit-menu:spectator",
      '<div class="exit-menu"><p class="eyebrow">Spectator controls</p><h2>Game menu</h2><div class="menu-actions"><button id="resume" class="primary">Resume</button><button id="quit-match" class="danger">Leave spectating</button></div></div>',
    );
    if (!changed) return;
    $("#resume").onclick = closeExitMenu;
    $("#quit-match").onclick = () => leaveLobby(false);
    return;
  }
  const restartRequested = state.restartRequestPlayerId === myId;
  const canRestart = state.phase === "playing";
  const changed = setOverlay(
    `exit-menu:${restartRequested}:${canRestart}`,
    `<div class="exit-menu"><p class="eyebrow">Match controls</p><h2>Game menu</h2><div class="menu-actions"><button id="resume" class="primary">Resume</button>${canRestart ? `<button id="restart-round"${restartRequested ? " disabled" : ""}>${restartRequested ? "Restart requested" : "Ask to restart round"}</button>` : ""}<button id="quit-match" class="danger">Quit</button></div></div>`,
  );
  if (!changed) return;
  $("#resume").onclick = closeExitMenu;
  if (canRestart) {
    $("#restart-round").onclick = () => {
      socket.emit("round:restart:request");
      $("#restart-round").disabled = true;
      $("#restart-round").textContent = "Restart requested";
    };
  }
  $("#quit-match").onclick = () => leaveLobby(false);
}

function drawRestartRequest() {
  const requester = state.players.find(
    (player) => player.id === state.restartRequestPlayerId,
  );
  const changed = setOverlay(
    `restart-request:${state.restartRequestPlayerId}`,
    `<div class="exit-menu"><p class="eyebrow">Restart request</p><h2>Restart this round?</h2><p>${escapeHtml(requester?.name || "Your opponent")} wants to restart the current round.</p><div class="menu-actions"><button id="accept-restart" class="primary">Accept</button><button id="decline-restart">Decline</button></div></div>`,
  );
  if (!changed) return;
  $("#accept-restart").onclick = () =>
    socket.emit("round:restart:respond", { accepted: true });
  $("#decline-restart").onclick = () =>
    socket.emit("round:restart:respond", { accepted: false });
}

function drawPowerSelection() {
  const me = myPlayer();
  const runner = state.players.find((player) => player.role === "runner");
  const isMyTurn = state.selectionPlayerId === myId;
  const revealed = runner.power
    ? `<p class="revealed">Runner chose <strong>${escapeHtml(config.powers[runner.power].name)}</strong>.</p>`
    : "";
  if (!me) {
    const chooser = state.players.find(
      (player) => player.id === state.selectionPlayerId,
    );
    const heading = `${escapeHtml(chooser?.role === "chaser" ? "Tagger" : "Runner")} is choosing`;
    const body = runner.power ? revealed : "<p>The runner chooses first.</p>";
    const powers = state.players.map((player) => player.power || "-").join(":");
    setOverlay(
      `power-select:spectator:${state.selectionPlayerId}:${powers}`,
      `<div class="power-select"><p class="eyebrow">Round ${state.round} · Spectating</p><h2>${heading}</h2><p class="eyebrow">Map: ${escapeHtml(activeMap().name)}</p>${body}</div>`,
    );
    return;
  }
  let heading;
  let body;

  if (isMyTurn) {
    heading =
      me.role === "runner"
        ? "Runner picks first"
        : "Tagger, choose your counter";
    body = `${revealed}<div class="power-grid">${Object.entries(config.powers)
      .map(
        ([powerId, power]) => `
      <button class="power-option" data-power="${powerId}">
        <strong>${escapeHtml(power.name)}</strong>
        <span>${escapeHtml(power.description)}</span>
      </button>`,
      )
      .join("")}</div>`;
  } else if (me.power) {
    heading = `${escapeHtml(config.powers[me.power].name)} locked in`;
    body = `<p>Waiting for the ${me.role === "runner" ? "tagger" : "runner"} to choose.</p>${revealed}`;
  } else {
    heading = "Runner is choosing";
    body = "<p>The tagger will see the runner’s power before choosing.</p>";
  }

  body = `<p class="eyebrow">Map: ${escapeHtml(activeMap().name)}</p>${body}`;
  const view = `power-select:${state.selectionPlayerId}:${state.players.map((player) => player.power || "-").join(":")}`;
  const changed = setOverlay(
    view,
    `<div class="power-select"><p class="eyebrow">Round ${state.round} · ${me.role}</p><h2>${heading}</h2>${body}</div>`,
  );
  if (changed && isMyTurn) {
    document.querySelectorAll(".power-option").forEach((button) => {
      button.onclick = () => {
        document
          .querySelectorAll(".power-option")
          .forEach((option) => (option.disabled = true));
        socket.emit("power:select", { powerId: button.dataset.power });
      };
    });
  }
}

let lastFrameTime = performance.now();

function frame() {
  const now = performance.now();
  const renderDt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  render(renderDt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
