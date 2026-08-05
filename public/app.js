const socket = io();
const config = window.GAME_CONFIG;
const $ = (selector) => document.querySelector(selector);
const screens = { lobby: $('#lobby-screen'), waiting: $('#waiting-screen'), game: $('#game-screen') };
const canvas = $('#game'); const ctx = canvas.getContext('2d');
let state = null; let myId = null; let sentInput = {};
const camera = {
  x: 0,
  y: 0,
  width: config.arena.width,
  height: config.arena.height,
  zoomOutVelocity: 0,
  lastUpdatedAt: 0,
  initialized: false
};
const input = { up: false, down: false, left: false, right: false, dash: false };

function show(name) {
  Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle('hidden', key !== name));
  document.body.classList.toggle('game-active', name === 'game');
}
function nameValue() { return $('#name').value.trim(); }
function clearError() { $('#lobby-error').textContent = ''; }
function sendLobby(event, extra = {}) { clearError(); socket.emit(event, { name: nameValue(), ...extra }); }
$('#create').onclick = () => sendLobby('lobby:create');
$('#join').onclick = () => sendLobby('lobby:join', { code: $('#code').value });
$('#code').addEventListener('input', () => { $('#code').value = $('#code').value.toUpperCase(); });
$('#leave').onclick = () => socket.emit('lobby:leave');

socket.on('connect', () => { myId = socket.id; });
socket.on('lobby:error', (message) => { $('#lobby-error').textContent = message; });
socket.on('lobby:left', () => { state = null; camera.initialized = false; show('lobby'); });
socket.on('lobby:state', (lobby) => {
  $('#lobby-code').textContent = lobby.code;
  $('#waiting-players').innerHTML = lobby.players.map((player, index) => `<div>${index + 1}. ${escapeHtml(player.name)}${player.id === myId ? ' (you)' : ''}</div>`).join('');
  if (!lobby.hasMatch) show('waiting'); else show('game');
});
socket.on('game:state', (nextState) => { state = nextState; show('game'); render(); });

function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
function setInput(event, active) {
  const keyMap = { Space: 'up', ArrowUp: 'up', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'dash', ShiftRight: 'dash' }; const key = keyMap[event.code];
  if (!key) return; event.preventDefault(); input[key] = active;
  const signature = JSON.stringify(input); if (signature !== sentInput.signature) { sentInput.signature = signature; socket.emit('input:update', input); }
}
addEventListener('keydown', (event) => setInput(event, true)); addEventListener('keyup', (event) => setInput(event, false));
addEventListener('blur', () => { Object.keys(input).forEach((key) => input[key] = false); socket.emit('input:update', input); });

function formatTime(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function updateCamera() {
  const now = performance.now();
  const dt = camera.lastUpdatedAt ? Math.min((now - camera.lastUpdatedAt) / 1000, 0.05) : 0;
  camera.lastUpdatedAt = now;
  const aspect = canvas.width / canvas.height;
  const left = Math.min(...state.players.map((player) => player.position.x));
  const right = Math.max(...state.players.map((player) => player.position.x + config.player.width));
  const top = Math.min(...state.players.map((player) => player.position.y));
  const bottom = Math.max(...state.players.map((player) => player.position.y + config.player.height));
  const horizontalTargetWidth = right - left + config.camera.paddingX * 2;
  const requiredHeight = bottom - top + config.camera.paddingY * 2;
  const targetWidth = clamp(
    Math.max(config.camera.minViewWidth, horizontalTargetWidth, requiredHeight * aspect),
    config.camera.minViewWidth,
    config.arena.width
  );
  const targetHeight = targetWidth / aspect;
  const targetX = clamp((left + right - targetWidth) / 2, 0, config.arena.width - targetWidth);
  const targetY = clamp((top + bottom - targetHeight) / 2, 0, config.arena.height - targetHeight);

  if (!camera.initialized) {
    Object.assign(camera, { x: targetX, y: targetY, width: targetWidth, height: targetHeight, zoomOutVelocity: 0, initialized: true });
    return camera;
  }

  const smoothing = 1 - Math.pow(1 - config.camera.zoomInSmoothing, dt * 60);
  const previousCenterX = camera.x + camera.width / 2;
  const zoomInThreshold = clamp(
    Math.max(config.camera.minViewWidth, horizontalTargetWidth + config.camera.deadZoneX, requiredHeight * aspect),
    config.camera.minViewWidth,
    config.arena.width
  );
  if (targetWidth > camera.width) {
    camera.zoomOutVelocity = Math.min(
      config.camera.zoomOutMaxSpeed,
      camera.zoomOutVelocity + config.camera.zoomOutAcceleration * dt
    );
    camera.width = Math.min(targetWidth, camera.width + camera.zoomOutVelocity * dt);
  } else {
    camera.zoomOutVelocity = Math.max(0, camera.zoomOutVelocity - config.camera.zoomOutDeceleration * dt);
    if (zoomInThreshold < camera.width) {
      camera.zoomOutVelocity = 0;
      camera.width += (zoomInThreshold - camera.width) * smoothing;
    }
  }
  camera.height = camera.width / aspect;
  camera.x = previousCenterX - camera.width / 2;

  const targetCenterX = (left + right) / 2;
  const currentCenterX = camera.x + camera.width / 2;
  const halfDeadZone = config.camera.deadZoneX / 2;
  const centerOffset = targetCenterX - currentCenterX;
  if (centerOffset > halfDeadZone) camera.x += (centerOffset - halfDeadZone) * smoothing;
  else if (centerOffset < -halfDeadZone) camera.x += (centerOffset + halfDeadZone) * smoothing;

  const currentTargetY = clamp((top + bottom - camera.height) / 2, 0, config.arena.height - camera.height);
  camera.y += (currentTargetY - camera.y) * smoothing;

  const playerSpanX = right - left;
  const playerSpanY = bottom - top;
  if (camera.width < playerSpanX) {
    camera.x = (left + right - camera.width) / 2;
  } else {
    const safePaddingX = Math.min(config.camera.paddingX, (camera.width - playerSpanX) / 2);
    camera.x = Math.min(camera.x, left - safePaddingX);
    camera.x = Math.max(camera.x, right + safePaddingX - camera.width);
  }
  if (camera.height < playerSpanY) {
    camera.y = (top + bottom - camera.height) / 2;
  } else {
    const safePaddingY = Math.min(config.camera.paddingY, (camera.height - playerSpanY) / 2);
    camera.y = Math.min(camera.y, top - safePaddingY);
    camera.y = Math.max(camera.y, bottom + safePaddingY - camera.height);
  }
  camera.x = clamp(camera.x, 0, config.arena.width - camera.width);
  camera.y = clamp(camera.y, 0, config.arena.height - camera.height);
  return camera;
}
function render() {
  if (!state) return;
  const now = Date.now(); const remaining = state.phaseEndsAt ? state.phaseEndsAt - now : 0;
  $('#scoreboard').innerHTML = state.players.map((player) => {
    const power = player.power ? config.powers[player.power]?.name : 'Choosing...';
    const cooldown = player.id === myId && player.power === 'dash' && player.dashCooldownMs > 0 ? ` · ${Math.ceil(player.dashCooldownMs / 100) / 10}s` : '';
    return `<div class="score"><span>${escapeHtml(player.name)}${player.id === myId ? ' · YOU' : ''}</span><b>${player.score}</b><em>${escapeHtml(power)}${cooldown}</em></div>`;
  }).join('');
  const view = updateCamera();
  drawArena(view); drawPlayers(view); drawTimer(remaining); drawOverlay(remaining);
}
function applyCamera(view) {
  ctx.scale(canvas.width / view.width, canvas.height / view.height);
  ctx.translate(-view.x, -view.y);
}
function drawArena(view) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height); sky.addColorStop(0, '#17283d'); sky.addColorStop(1, '#0a0d12');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); applyCamera(view);
  ctx.fillStyle = 'rgba(103,232,249,.08)';
  for (let x = 35; x < config.arena.width; x += 125) ctx.fillRect(x, 70 + (Math.floor(x / 125) % 6) * 150, 76, 2);
  config.platforms.forEach((platform) => {
    ctx.fillStyle = '#343d4c'; ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    ctx.fillStyle = '#67e8f9'; ctx.fillRect(platform.x, platform.y, platform.width, 4);
  });
  ctx.restore();
}
function drawPlayers(view) {
  const scale = canvas.width / view.width;
  ctx.save(); applyCamera(view);
  state.players.forEach((player) => {
    ctx.fillStyle = player.role === 'chaser' ? '#fb7185' : '#67e8f9';
    ctx.fillRect(player.position.x, player.position.y, config.player.width, config.player.height);
  });
  ctx.restore();
  state.players.forEach((player) => {
    const isChaser = player.role === 'chaser';
    const centerX = (player.position.x + config.player.width / 2 - view.x) * scale;
    const topY = (player.position.y - view.y) * scale;
    const bottomY = (player.position.y + config.player.height - view.y) * scale;
    ctx.fillStyle = '#e9edf6'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${player.name}${player.id === myId ? ' (YOU)' : ''}`, centerX, topY - 8);
    ctx.fillStyle = isChaser ? '#fb7185' : '#67e8f9'; ctx.font = 'bold 11px system-ui'; ctx.fillText(isChaser ? 'TAGGER' : 'RUNNER', centerX, bottomY + 14);
  });
}
function drawTimer(remaining) {
  if (state.phase !== 'playing') return;
  const text = formatTime(remaining);
  ctx.save();
  ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 40;
  const x = canvas.width / 2; const y = 34;
  ctx.fillStyle = 'rgba(10, 13, 18, .78)';
  ctx.fillRect(x - width / 2, y - 19, width, 38);
  ctx.strokeStyle = 'rgba(103, 232, 249, .55)'; ctx.lineWidth = 1;
  ctx.strokeRect(x - width / 2, y - 19, width, 38);
  ctx.fillStyle = '#e9edf6'; ctx.fillText(text, x, y);
  ctx.restore();
}
function setOverlay(view, html) {
  const overlay = $('#overlay');
  if (overlay.dataset.view === view) return false;
  overlay.dataset.view = view;
  overlay.innerHTML = html;
  return true;
}
function drawOverlay(remaining) {
  if (state.phase === 'power-select') {
    drawPowerSelection();
    return;
  }
  if (state.phase === 'countdown') {
    const count = Math.max(1, Math.ceil(remaining / 1000));
    const role = state.players.find((player) => player.id === myId)?.role;
    setOverlay(`countdown:${count}:${role}`, `<div><h2>${count}</h2><p>${role === 'chaser' ? 'You are the tagger. Touch the runner.' : 'You are the runner. Stay away.'}</p></div>`);
    return;
  }
  if (state.phase === 'result') {
    const mine = state.result.winnerId === myId;
    setOverlay(`result:${state.round}:${state.result.winnerId}:${state.result.reason}`, `<div><h2>${mine ? 'Round won' : 'Round lost'}</h2><p>${escapeHtml(state.result.winnerName)} won by ${state.result.reason === 'tag' ? 'tagging' : 'surviving'}.</p></div>`);
    return;
  }
  if (state.phase === 'match-over') {
    const winner = state.result;
    const mine = winner?.winnerId === myId;
    const votes = state.rematchVotes?.length || 0;
    const hasVoted = state.rematchVotes?.includes(myId);
    const label = hasVoted ? `Waiting for opponent (${votes}/2)` : votes ? `Accept rematch (${votes}/2)` : 'Rematch';
    const changed = setOverlay(
      `match-over:${winner?.winnerId}:${winner?.reason}:${votes}:${hasVoted}`,
      `<div><h2>${mine ? 'You win the match' : 'Match over'}</h2><p>${winner ? `${escapeHtml(winner.winnerName)} won${winner.reason === 'forfeit' ? ' by forfeit' : ''}.` : ''}</p><button id="rematch"${hasVoted ? ' disabled' : ''}>${label}</button></div>`
    );
    if (changed && !hasVoted) $('#rematch').onclick = () => socket.emit('match:rematch');
    return;
  }
  setOverlay('playing', '');
}

function drawPowerSelection() {
  const me = state.players.find((player) => player.id === myId);
  const runner = state.players.find((player) => player.role === 'runner');
  const isMyTurn = state.selectionPlayerId === myId;
  const revealed = runner.power ? `<p class="revealed">Runner chose <strong>${escapeHtml(config.powers[runner.power].name)}</strong>.</p>` : '';
  let heading;
  let body;

  if (isMyTurn) {
    heading = me.role === 'runner' ? 'Runner picks first' : 'Tagger, choose your counter';
    body = `${revealed}<div class="power-grid">${Object.entries(config.powers).map(([powerId, power]) => `
      <button class="power-option" data-power="${powerId}">
        <strong>${escapeHtml(power.name)}</strong>
        <span>${escapeHtml(power.description)}</span>
      </button>`).join('')}</div>`;
  } else if (me.power) {
    heading = `${escapeHtml(config.powers[me.power].name)} locked in`;
    body = `<p>Waiting for the ${me.role === 'runner' ? 'tagger' : 'runner'} to choose.</p>${revealed}`;
  } else {
    heading = 'Runner is choosing';
    body = '<p>The tagger will see the runner’s power before choosing.</p>';
  }

  const view = `power-select:${state.selectionPlayerId}:${state.players.map((player) => player.power || '-').join(':')}`;
  const changed = setOverlay(view, `<div class="power-select"><p class="eyebrow">Round ${state.round} · ${me.role}</p><h2>${heading}</h2>${body}</div>`);
  if (changed && isMyTurn) {
    document.querySelectorAll('.power-option').forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll('.power-option').forEach((option) => option.disabled = true);
        socket.emit('power:select', { powerId: button.dataset.power });
      };
    });
  }
}
setInterval(render, 100);
