const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const CONFIG = require("./shared/game-config");
const {
  lobbies,
  createLobby,
  joinLobby,
  spectateLobby,
  removePlayer,
  removeSpectator,
} = require("./server/lobbies");
const {
  createMatch,
  selectPower,
  fireSnowball,
  requestRoundRestart,
  respondToRoundRestart,
  tickMatch,
  publicMatch,
} = require("./server/game");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(path.join(__dirname, "public")));
app.get("/game-config.js", (_req, res) =>
  res
    .type("application/javascript")
    .send(`window.GAME_CONFIG=${JSON.stringify(CONFIG)};`),
);

function validName(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 18
  );
}
function validMapId(value) {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CONFIG.maps, value)
  );
}
function emitLobby(lobby) {
  io.to(lobby.code).emit("lobby:state", {
    code: lobby.code,
    mapId: lobby.mapId,
    players: lobby.players.map(({ id, name }) => ({ id, name })),
    spectators: lobby.spectators.map(({ id, name }) => ({ id, name })),
    hasMatch: Boolean(lobby.match),
  });
}
function emitMatch(lobby) {
  if (lobby.match)
    io.to(lobby.code).emit("game:state", publicMatch(lobby.match));
}
function exitCurrentLobby(socket, disconnected = false) {
  const lobbyCode = socket.data.lobbyCode;
  if (!lobbyCode) return;
  const lobby = lobbies.get(lobbyCode);
  socket.leave(lobbyCode);
  socket.data.lobbyCode = null;
  if (!lobby) return;
  const departing = lobby.players.find((player) => player.id === socket.id);
  const departingSpectator = lobby.spectators.find(
    (spectator) => spectator.id === socket.id,
  );
  if (departingSpectator) {
    removeSpectator(lobby, socket.id);
    emitLobby(lobby);
    if (!disconnected) socket.emit("lobby:left");
    return;
  }
  if (!departing) {
    if (!disconnected) socket.emit("lobby:left");
    return;
  }
  const remaining = lobby.players.find((player) => player.id !== socket.id);
  if (lobby.match && remaining && lobby.match.phase !== "match-over") {
    lobby.match.phase = "match-over";
    lobby.match.result = {
      winnerId: remaining.id,
      winnerName: remaining.name,
      reason: "forfeit",
    };
    io.to(lobby.code).emit("game:state", publicMatch(lobby.match));
    io.to(lobby.code).emit(
      "game:notice",
      `${departing?.name || "Opponent"} disconnected. You win by forfeit.`,
    );
  }
  removePlayer(lobby, socket.id);
  if (lobbies.has(lobbyCode)) {
    lobby.match = null;
    emitLobby(lobby);
  } else {
    io.to(lobbyCode).emit("lobby:closed");
  }
  if (!disconnected) socket.emit("lobby:left");
}

io.on("connection", (socket) => {
  socket.on("lobby:create", ({ name, mapId } = {}) => {
    if (!validName(name))
      return socket.emit(
        "lobby:error",
        "Enter a name from 1 to 18 characters.",
      );
    if (!validMapId(mapId))
      return socket.emit("lobby:error", "Choose a valid map.");
    exitCurrentLobby(socket);
    const lobby = createLobby({ id: socket.id, name: name.trim() }, mapId);
    socket.join(lobby.code);
    socket.data.lobbyCode = lobby.code;
    emitLobby(lobby);
  });
  socket.on("lobby:join", ({ name, code } = {}) => {
    if (!validName(name))
      return socket.emit(
        "lobby:error",
        "Enter a name from 1 to 18 characters.",
      );
    if (typeof code !== "string")
      return socket.emit("lobby:error", "Enter a lobby code.");
    exitCurrentLobby(socket);
    const result = joinLobby(code.trim().toUpperCase(), {
      id: socket.id,
      name: name.trim(),
    });
    if (result.error) return socket.emit("lobby:error", result.error);
    socket.join(result.lobby.code);
    socket.data.lobbyCode = result.lobby.code;
    emitLobby(result.lobby);
    emitMatch(result.lobby);
  });
  socket.on("lobby:spectate", ({ name, code } = {}) => {
    if (!validName(name))
      return socket.emit(
        "lobby:error",
        "Enter a name from 1 to 18 characters.",
      );
    if (typeof code !== "string")
      return socket.emit("lobby:error", "Enter a lobby code.");
    exitCurrentLobby(socket);
    const result = spectateLobby(code.trim().toUpperCase(), {
      id: socket.id,
      name: name.trim(),
    });
    if (result.error) return socket.emit("lobby:error", result.error);
    socket.join(result.lobby.code);
    socket.data.lobbyCode = result.lobby.code;
    emitLobby(result.lobby);
    emitMatch(result.lobby);
  });
  socket.on("lobby:leave", () => exitCurrentLobby(socket));
  socket.on("input:update", (input = {}) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const player = lobby?.match?.players.find(
      (candidate) => candidate.id === socket.id,
    );
    if (!player) return;
    player.input = {
      up: Boolean(input.up),
      down: Boolean(input.down),
      left: Boolean(input.left),
      right: Boolean(input.right),
      dash: Boolean(input.dash),
      realm: Boolean(input.realm),
    };
  });
  socket.on("power:select", ({ powerId } = {}) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const match = lobby?.match;
    if (!match || !selectPower(match, socket.id, powerId)) return;
    emitMatch(lobby);
  });
  socket.on("power:use", ({ target } = {}) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const match = lobby?.match;
    if (!match || !fireSnowball(match, socket.id, target)) return;
    emitMatch(lobby);
  });
  socket.on("round:restart:request", () => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const match = lobby?.match;
    if (!match || !requestRoundRestart(match, socket.id)) return;
    emitMatch(lobby);
  });
  socket.on("round:restart:respond", ({ accepted } = {}) => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const match = lobby?.match;
    if (!match || !respondToRoundRestart(match, socket.id, accepted)) return;
    emitMatch(lobby);
  });
  socket.on("match:rematch", () => {
    const lobby = lobbies.get(socket.data.lobbyCode);
    const match = lobby?.match;
    if (
      !match ||
      match.phase !== "match-over" ||
      !match.players.some((player) => player.id === socket.id)
    )
      return;
    match.rematchVotes.add(socket.id);
    if (match.rematchVotes.size === 2)
      lobby.match = createMatch(lobby.players, lobby.mapId);
    emitMatch(lobby);
  });
  socket.on("disconnect", () => exitCurrentLobby(socket, true));
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;
  lobbies.forEach((lobby) => {
    if (lobby.match) {
      tickMatch(lobby.match, dt, now);
      emitMatch(lobby);
    }
  });
}, 1000 / CONFIG.tickRate);

const port = process.env.PORT || 3000;
httpServer.listen(port, () =>
  console.log(`Tag server listening on http://localhost:${port}`),
);
