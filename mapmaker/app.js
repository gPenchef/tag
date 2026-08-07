const config = window.MAPMAKER_CONFIG;
const { validateMap } = window.MAP_SCHEMA;
const $ = (selector) => document.querySelector(selector);
const canvas = $('#editor');
const ctx = canvas.getContext('2d');
const toolHelp = {
  select: 'Click an object to select it, then drag to move it.',
  platform: 'Drag on the canvas to create a platform.',
  'jump-pad': 'Click near a platform to place a jump pad on top of it.',
  'spawn-0': 'Click to place player A on the nearest platform below.',
  'spawn-1': 'Click to place player B on the nearest platform below.',
  erase: 'Click a platform or jump pad to remove it.'
};

let map = createMap();
let activeTool = 'select';
let selected = null;
let interaction = null;
let pointerWorld = { x: 0, y: 0 };
let past = [];
let future = [];

function createMap() {
  return {
    id: 'untitled-map',
    name: 'Untitled Map',
    description: 'A custom arena.',
    arena: { width: 1800, height: 1000 },
    theme: { skyTop: '#17283d', skyBottom: '#0a0d12', accent: '#67e8f9' },
    platforms: [{ x: 0, y: 960, width: 1800, height: 40 }],
    jumpPads: [],
    spawns: [{ x: 120, y: 940 }, { x: 1660, y: 940 }]
  };
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function gridSize() { return Number($('#grid-size').value) || 20; }
function snap(value) { const grid = gridSize(); return Math.round(value / grid) * grid; }
function numberValue(selector, fallback) { const value = Number($(selector).value); return Number.isFinite(value) ? value : fallback; }

function setStatus(message, type = '') {
  const status = $('#status');
  status.className = `status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function saveHistory() {
  past.push(JSON.stringify(map));
  if (past.length > 60) past.shift();
  future = [];
  updateHistoryButtons();
}

function restoreSnapshot(snapshot) {
  map = JSON.parse(snapshot);
  selected = null;
  interaction = null;
  syncFields();
  render();
}

function undo() {
  if (!past.length) return;
  future.push(JSON.stringify(map));
  restoreSnapshot(past.pop());
  updateHistoryButtons();
}

function redo() {
  if (!future.length) return;
  past.push(JSON.stringify(map));
  restoreSnapshot(future.pop());
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#undo').disabled = !past.length;
  $('#redo').disabled = !future.length;
}

function syncFields() {
  $('#map-id').value = map.id;
  $('#map-name').value = map.name;
  $('#map-description').value = map.description;
  $('#arena-width').value = map.arena.width;
  $('#arena-height').value = map.arena.height;
  $('#sky-top').value = map.theme.skyTop;
  $('#sky-bottom').value = map.theme.skyBottom;
  $('#accent').value = map.theme.accent;
  updateEditorMeta();
  updateInspector();
}

function updateMapDetails() {
  map.id = $('#map-id').value.trim();
  map.name = $('#map-name').value.trim();
  map.description = $('#map-description').value.trim();
  map.arena.width = clamp(numberValue('#arena-width', map.arena.width), 400, 6000);
  map.arena.height = clamp(numberValue('#arena-height', map.arena.height), 300, 4000);
  map.theme.skyTop = $('#sky-top').value;
  map.theme.skyBottom = $('#sky-bottom').value;
  map.theme.accent = $('#accent').value;
  updateEditorMeta();
  render();
}

function updateEditorMeta() {
  $('#editor-map-name').textContent = map.name || 'Untitled Map';
  $('#editor-size').textContent = `${map.arena.width} × ${map.arena.height}`;
}

function setTool(tool) {
  activeTool = tool;
  interaction = null;
  document.querySelectorAll('.tool').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  $('#tool-help').textContent = toolHelp[tool];
  canvas.style.cursor = tool === 'select' ? 'default' : tool === 'erase' ? 'not-allowed' : 'crosshair';
  render();
}

function currentObject() {
  if (!selected) return null;
  if (selected.type === 'platform') return map.platforms[selected.index] || null;
  if (selected.type === 'jumpPad') return map.jumpPads[selected.index] || null;
  if (selected.type === 'spawn') return map.spawns[selected.index] || null;
  return null;
}

function objectRectangle(selection) {
  const object = selection && (selection.type === 'platform' ? map.platforms[selection.index] :
    selection.type === 'jumpPad' ? map.jumpPads[selection.index] : map.spawns[selection.index]);
  if (!object) return null;
  if (selection.type === 'spawn') return { ...object, width: config.player.width, height: config.player.height };
  return object;
}

function containsPoint(rectangle, point) {
  return point.x >= rectangle.x && point.x <= rectangle.x + rectangle.width &&
    point.y >= rectangle.y && point.y <= rectangle.y + rectangle.height;
}

function hitTest(point, includeSpawns = true) {
  if (includeSpawns) {
    for (let index = map.spawns.length - 1; index >= 0; index -= 1) {
      const selection = { type: 'spawn', index };
      if (containsPoint(objectRectangle(selection), point)) return selection;
    }
  }
  for (let index = map.jumpPads.length - 1; index >= 0; index -= 1) {
    const selection = { type: 'jumpPad', index };
    if (containsPoint(objectRectangle(selection), point)) return selection;
  }
  for (let index = map.platforms.length - 1; index >= 0; index -= 1) {
    const selection = { type: 'platform', index };
    if (containsPoint(objectRectangle(selection), point)) return selection;
  }
  return null;
}

function updateInspector() {
  const object = currentObject();
  $('#object-inspector').classList.toggle('hidden', !object);
  if (!object) return;
  const label = selected.type === 'spawn' ? `Player ${selected.index ? 'B' : 'A'} spawn` :
    selected.type === 'jumpPad' ? 'Jump pad' : 'Platform';
  $('#selected-type').textContent = label;
  $('#object-x').value = object.x;
  $('#object-y').value = object.y;
  $('#object-size').classList.toggle('hidden', selected.type === 'spawn');
  $('#launch-speed-row').classList.toggle('hidden', selected.type !== 'jumpPad');
  $('#delete-selected').classList.toggle('hidden', selected.type === 'spawn');
  if (selected.type !== 'spawn') {
    $('#object-width').value = object.width;
    $('#object-height').value = object.height;
  }
  if (selected.type === 'jumpPad') $('#object-launch-speed').value = object.launchSpeed;
}

function applyInspectorChange(property, selector) {
  const object = currentObject();
  if (!object) return;
  const value = Number($(selector).value);
  if (!Number.isFinite(value)) return;
  saveHistory();
  object[property] = value;
  updateInspector();
  render();
}

function removeSelection(selection = selected) {
  if (!selection) return;
  if (selection.type === 'spawn') {
    setStatus('Spawn points cannot be deleted. Move them with a spawn tool instead.', 'error');
    return;
  }
  saveHistory();
  if (selection.type === 'platform') map.platforms.splice(selection.index, 1);
  else map.jumpPads.splice(selection.index, 1);
  selected = null;
  updateInspector();
  render();
}

function editorView() {
  const scale = Math.min(canvas.width / map.arena.width, canvas.height / map.arena.height);
  const width = map.arena.width * scale;
  const height = map.arena.height * scale;
  return { scale, x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height };
}

function eventWorldPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const canvasPoint = {
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height
  };
  const view = editorView();
  return {
    x: clamp((canvasPoint.x - view.x) / view.scale, 0, map.arena.width),
    y: clamp((canvasPoint.y - view.y) / view.scale, 0, map.arena.height)
  };
}

function supportingPlatform(point, maximumDistance = Infinity) {
  return map.platforms
    .filter((platform) => point.x >= platform.x && point.x <= platform.x + platform.width &&
      platform.y >= point.y - 80 && platform.y - point.y <= maximumDistance)
    .sort((first, second) => Math.abs(first.y - point.y) - Math.abs(second.y - point.y))[0] || null;
}

function placeJumpPad(point) {
  const platform = supportingPlatform(point, 120);
  if (!platform) {
    setStatus('Place jump pads near the top of a platform.', 'error');
    return;
  }
  const width = Math.min(60, platform.width);
  saveHistory();
  map.jumpPads.push({
    x: clamp(snap(point.x - width / 2), platform.x, platform.x + platform.width - width),
    y: platform.y - 10,
    width,
    height: 10,
    launchSpeed: 950
  });
  selected = { type: 'jumpPad', index: map.jumpPads.length - 1 };
  updateInspector();
  setStatus('Jump pad added. Adjust its launch speed in the inspector.', 'success');
  render();
}

function placeSpawn(index, point) {
  const platform = supportingPlatform(point);
  saveHistory();
  const spawn = map.spawns[index];
  spawn.x = clamp(snap(point.x - config.player.width / 2), 0, map.arena.width - config.player.width);
  spawn.y = platform ? platform.y - config.player.height :
    clamp(snap(point.y - config.player.height / 2), 0, map.arena.height - config.player.height);
  selected = { type: 'spawn', index };
  updateInspector();
  setStatus(`Player ${index ? 'B' : 'A'} spawn moved.`, 'success');
  render();
}

function beginPointerAction(event) {
  if (event.button !== 0) return;
  const point = eventWorldPoint(event);
  pointerWorld = point;
  canvas.setPointerCapture(event.pointerId);
  if (activeTool === 'platform') {
    interaction = { kind: 'draw-platform', start: { x: snap(point.x), y: snap(point.y) }, current: point };
  } else if (activeTool === 'jump-pad') {
    placeJumpPad(point);
  } else if (activeTool === 'spawn-0' || activeTool === 'spawn-1') {
    placeSpawn(activeTool === 'spawn-0' ? 0 : 1, point);
  } else if (activeTool === 'erase') {
    const target = hitTest(point, false);
    if (target) removeSelection(target);
  } else {
    selected = hitTest(point);
    updateInspector();
    if (selected) {
      const object = currentObject();
      saveHistory();
      interaction = { kind: 'move', offsetX: point.x - object.x, offsetY: point.y - object.y };
    }
    render();
  }
  event.preventDefault();
}

function movePointerAction(event) {
  const point = eventWorldPoint(event);
  pointerWorld = point;
  $('#pointer-position').textContent = `x ${Math.round(point.x)} · y ${Math.round(point.y)}`;
  if (interaction?.kind === 'draw-platform') interaction.current = point;
  if (interaction?.kind === 'move') {
    const object = currentObject();
    if (object) {
      const width = selected.type === 'spawn' ? config.player.width : object.width;
      const height = selected.type === 'spawn' ? config.player.height : object.height;
      object.x = clamp(snap(point.x - interaction.offsetX), 0, map.arena.width - width);
      object.y = clamp(snap(point.y - interaction.offsetY), 0, map.arena.height - height);
      updateInspector();
    }
  }
  render();
}

function endPointerAction(event) {
  if (interaction?.kind === 'draw-platform') {
    const start = interaction.start;
    const end = { x: snap(interaction.current.x), y: snap(interaction.current.y) };
    const x = clamp(Math.min(start.x, end.x), 0, map.arena.width - 1);
    const y = clamp(Math.min(start.y, end.y), 0, map.arena.height - 1);
    const width = Math.min(Math.max(gridSize(), Math.abs(end.x - start.x)), map.arena.width - x);
    const height = Math.min(Math.max(gridSize(), Math.abs(end.y - start.y)), map.arena.height - y);
    saveHistory();
    map.platforms.push({ x, y, width, height });
    selected = { type: 'platform', index: map.platforms.length - 1 };
    updateInspector();
    setStatus('Platform added.', 'success');
  }
  interaction = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  render();
}

function drawGrid(view) {
  const grid = gridSize();
  if (grid * view.scale < 5) return;
  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 1 / view.scale;
  ctx.beginPath();
  for (let x = grid; x < map.arena.width; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, map.arena.height); }
  for (let y = grid; y < map.arena.height; y += grid) { ctx.moveTo(0, y); ctx.lineTo(map.arena.width, y); }
  ctx.stroke();
}

function drawSelection(view) {
  const rectangle = objectRectangle(selected);
  if (!rectangle) return;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 3 / view.scale;
  ctx.setLineDash([10 / view.scale, 6 / view.scale]);
  ctx.strokeRect(rectangle.x - 3 / view.scale, rectangle.y - 3 / view.scale,
    rectangle.width + 6 / view.scale, rectangle.height + 6 / view.scale);
  ctx.setLineDash([]);
}

function drawPlatformPreview(view) {
  if (interaction?.kind !== 'draw-platform') return;
  const start = interaction.start;
  const end = interaction.current;
  ctx.fillStyle = 'rgba(103,232,249,.22)';
  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 2 / view.scale;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.max(gridSize(), Math.abs(end.x - start.x));
  const height = Math.max(gridSize(), Math.abs(end.y - start.y));
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
}

function render() {
  const view = editorView();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#080b0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sky = ctx.createLinearGradient(0, view.y, 0, view.y + view.height);
  sky.addColorStop(0, map.theme.skyTop);
  sky.addColorStop(1, map.theme.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(view.x, view.y, view.width, view.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  ctx.beginPath();
  ctx.rect(0, 0, map.arena.width, map.arena.height);
  ctx.clip();
  drawGrid(view);
  map.platforms.forEach((platform) => {
    ctx.fillStyle = '#343d4c';
    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    ctx.fillStyle = map.theme.accent;
    ctx.fillRect(platform.x, platform.y, platform.width, Math.min(4, platform.height));
  });
  map.jumpPads.forEach((pad) => {
    ctx.fillStyle = '#a3e635';
    ctx.fillRect(pad.x, pad.y, pad.width, pad.height);
  });
  map.spawns.forEach((spawn, index) => {
    ctx.fillStyle = index ? '#fb7185' : '#67e8f9';
    ctx.fillRect(spawn.x, spawn.y, config.player.width, config.player.height);
    ctx.fillStyle = '#f8fafc';
    ctx.font = `bold ${14 / view.scale}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(index ? 'B' : 'A', spawn.x + config.player.width / 2, spawn.y - 7 / view.scale);
  });
  drawPlatformPreview(view);
  drawSelection(view);
  ctx.restore();
  ctx.strokeStyle = '#4a5665';
  ctx.lineWidth = 1;
  ctx.strokeRect(view.x + .5, view.y + .5, view.width - 1, view.height - 1);
}

function addFloor() {
  saveHistory();
  const height = 40;
  map.platforms.push({ x: 0, y: map.arena.height - height, width: map.arena.width, height });
  selected = { type: 'platform', index: map.platforms.length - 1 };
  updateInspector();
  setStatus('Floor platform added.', 'success');
  render();
}

function exportMap() {
  updateMapDetails();
  const errors = validateMap(map, config);
  if (errors.length) {
    setStatus(`Cannot export: ${errors.join(' ')}`, 'error');
    return;
  }
  const blob = new Blob([`${JSON.stringify(map, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${map.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus(`${map.name} exported as ${map.id}.json.`, 'success');
}

async function importMap(file) {
  if (!file) return;
  try {
    const candidate = JSON.parse(await file.text());
    const errors = validateMap(candidate, config);
    if (errors.length) throw new Error(errors.join(' '));
    map = copy(candidate);
    selected = null;
    past = [];
    future = [];
    syncFields();
    updateHistoryButtons();
    setStatus(`${map.name} opened successfully.`, 'success');
    render();
  } catch (error) {
    setStatus(`Could not open map: ${error.message}`, 'error');
  } finally {
    $('#import-map').value = '';
  }
}

document.querySelectorAll('.tool').forEach((button) => button.onclick = () => setTool(button.dataset.tool));
['#map-id', '#map-name', '#map-description', '#arena-width', '#arena-height', '#sky-top', '#sky-bottom', '#accent']
  .forEach((selector) => $(selector).addEventListener('input', updateMapDetails));
$('#grid-size').onchange = render;
$('#add-floor').onclick = addFloor;
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#delete-selected').onclick = () => removeSelection();
$('#object-x').onchange = () => applyInspectorChange('x', '#object-x');
$('#object-y').onchange = () => applyInspectorChange('y', '#object-y');
$('#object-width').onchange = () => applyInspectorChange('width', '#object-width');
$('#object-height').onchange = () => applyInspectorChange('height', '#object-height');
$('#object-launch-speed').onchange = () => applyInspectorChange('launchSpeed', '#object-launch-speed');
$('#export-map').onclick = exportMap;
$('#import-map').onchange = (event) => importMap(event.target.files[0]);
$('#new-map').onclick = () => {
  if (!confirm('Start a new map? Unsaved changes will be lost.')) return;
  map = createMap();
  selected = null;
  past = [];
  future = [];
  syncFields();
  updateHistoryButtons();
  setStatus('New map created.');
  render();
};
canvas.addEventListener('pointerdown', beginPointerAction);
canvas.addEventListener('pointermove', movePointerAction);
canvas.addEventListener('pointerup', endPointerAction);
canvas.addEventListener('pointercancel', endPointerAction);
addEventListener('keydown', (event) => {
  const editingField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
  if (editingField) return;
  if (event.code === 'Delete' || event.code === 'Backspace') { event.preventDefault(); removeSelection(); return; }
  const shortcuts = { Digit1: 'select', Digit2: 'platform', Digit3: 'jump-pad', Digit4: 'spawn-0', Digit5: 'spawn-1', Digit6: 'erase' };
  if (shortcuts[event.code]) setTool(shortcuts[event.code]);
});

syncFields();
updateHistoryButtons();
setTool('select');
render();
