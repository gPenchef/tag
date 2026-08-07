(function exposeMapSchema(root, factory) {
  const schema = factory();
  if (typeof module === 'object' && module.exports) module.exports = schema;
  else root.MAP_SCHEMA = schema;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const mapIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function rectangleIsInsideArena(rectangle, arena) {
    return isObject(rectangle) &&
      isFiniteNumber(rectangle.x) && isFiniteNumber(rectangle.y) &&
      isFiniteNumber(rectangle.width) && isFiniteNumber(rectangle.height) &&
      rectangle.width > 0 && rectangle.height > 0 &&
      rectangle.x >= 0 && rectangle.y >= 0 &&
      rectangle.x + rectangle.width <= arena.width &&
      rectangle.y + rectangle.height <= arena.height;
  }

  function rectanglesOverlap(first, second) {
    return first.x < second.x + second.width && first.x + first.width > second.x &&
      first.y < second.y + second.height && first.y + first.height > second.y;
  }

  function validateMap(map, config) {
    const errors = [];
    if (!isObject(map)) return ['Map must be a JSON object.'];
    if (typeof map.id !== 'string' || !mapIdPattern.test(map.id)) {
      errors.push('Map id must use lowercase letters, numbers, and single hyphens.');
    }
    if (typeof map.name !== 'string' || !map.name.trim()) errors.push('Map name is required.');
    if (typeof map.description !== 'string' || !map.description.trim()) errors.push('Map description is required.');
    if (!isObject(map.arena) || !isFiniteNumber(map.arena.width) || !isFiniteNumber(map.arena.height) ||
      map.arena.width <= 0 || map.arena.height <= 0) {
      errors.push('Arena must have positive numeric width and height.');
      return errors;
    }
    if (!isObject(map.theme) || ['skyTop', 'skyBottom', 'accent'].some((key) => typeof map.theme[key] !== 'string')) {
      errors.push('Theme must include skyTop, skyBottom, and accent colors.');
    }
    if (!Array.isArray(map.platforms) || !map.platforms.length) errors.push('Map needs at least one platform.');
    else if (map.platforms.some((platform) => !rectangleIsInsideArena(platform, map.arena))) {
      errors.push('Every platform must be a positive rectangle inside the arena.');
    }
    if (!Array.isArray(map.jumpPads)) errors.push('Jump pads must be an array.');
    else if (map.jumpPads.some((pad) => !rectangleIsInsideArena(pad, map.arena) || !isFiniteNumber(pad.launchSpeed) || pad.launchSpeed <= 0)) {
      errors.push('Every jump pad must be inside the arena and have a positive launchSpeed.');
    } else if (Array.isArray(map.platforms) && map.jumpPads.some((pad) => !map.platforms.some((platform) =>
      pad.y + pad.height === platform.y && pad.x < platform.x + platform.width && pad.x + pad.width > platform.x
    ))) {
      errors.push('Every jump pad must rest on top of a platform.');
    }
    if (!Array.isArray(map.spawns) || map.spawns.length !== 2) {
      errors.push('Map must have exactly two spawn points.');
    } else if (map.spawns.some((spawn) => !isObject(spawn) || !isFiniteNumber(spawn.x) || !isFiniteNumber(spawn.y) ||
      spawn.x < 0 || spawn.y < 0 || spawn.x + config.player.width > map.arena.width ||
      spawn.y + config.player.height > map.arena.height)) {
      errors.push('Every spawn must fit inside the arena for the current player size.');
    } else if (Array.isArray(map.platforms) && map.spawns.some((spawn) => map.platforms.some((platform) =>
      rectanglesOverlap({ ...spawn, width: config.player.width, height: config.player.height }, platform)
    ))) {
      errors.push('Spawn points cannot overlap platforms.');
    }
    return errors;
  }

  return { validateMap };
});
