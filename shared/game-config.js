const GAME_CONFIG = {
  arena: { width: 2250, height: 1280 },
  camera: {
    minViewWidth: 700,
    paddingX: 220,
    paddingY: 130,
    deadZoneX: 135,
    zoomInSmoothing: 0.12,
    zoomOutAcceleration: 2_600,
    zoomOutDeceleration: 900,
    zoomOutMaxSpeed: 1_000
  },
  player: { width: 30, height: 60, speed: 275, jumpSpeed: 733.2, jumpReleaseMultiplier: 0.45, gravity: 1450, maxFallSpeed: 760, coyoteTimeMs: 100 },
  round: { durationMs: 60_000, countdownMs: 3_000, resultMs: 3_000, winsToMatch: 3 },
  powers: {
    dash: {
      name: 'Dash',
      description: 'Burst horizontally with Shift. Recharges after a short cooldown.',
      speed: 720,
      durationMs: 180,
      cooldownMs: 1_250
    },
    'double-jump': {
      name: 'Double Jump',
      description: 'Jump once more while airborne. The extra jump refreshes when you land.'
    }
  },
  tickRate: 60,
  platforms: [
    { x: 0, y: 1080, width: 1800, height: 40 },
    { x: 75, y: 930, width: 270, height: 26 },
    { x: 440, y: 860, width: 260, height: 26 },
    { x: 790, y: 940, width: 250, height: 26 },
    { x: 1130, y: 850, width: 280, height: 26 },
    { x: 1500, y: 930, width: 230, height: 26 },
    { x: 250, y: 730, width: 270, height: 26 },
    { x: 650, y: 700, width: 270, height: 26 },
    { x: 1030, y: 730, width: 270, height: 26 },
    { x: 1420, y: 700, width: 290, height: 26 },
    { x: 75, y: 560, width: 270, height: 26 },
    { x: 470, y: 540, width: 250, height: 26 },
    { x: 850, y: 570, width: 260, height: 26 },
    { x: 1230, y: 540, width: 250, height: 26 },
    { x: 1560, y: 520, width: 180, height: 26 },
    { x: 75, y: 400, width: 195, height: 26 },
    { x: 350, y: 325, width: 200, height: 26 },
    { x: 650, y: 400, width: 220, height: 26 },
    { x: 990, y: 380, width: 240, height: 26 },
    { x: 1350, y: 390, width: 250, height: 26 },
    { x: 1590, y: 300, width: 160, height: 26 },
    { x: 195, y: 205, width: 190, height: 26 },
    { x: 600, y: 230, width: 220, height: 26 },
    { x: 980, y: 210, width: 250, height: 26 },
    { x: 1350, y: 190, width: 260, height: 26 },
    { x: 410, y: 110, width: 125, height: 26 }
  ].map((platform) => ({
    ...platform,
    x: platform.x * 1.25,
    y: platform.y + 160,
    width: platform.width * 1.25
  })).concat([{ x: 510, y: 95, width: 250, height: 26 }]),
  spawns: [
    { x: 220, y: 1020 },
    { x: 1550, y: 1020 }
  ].map((spawn) => ({ x: spawn.x * 1.25, y: spawn.y + 160 }))
};

module.exports = GAME_CONFIG;
