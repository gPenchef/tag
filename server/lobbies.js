const { createMatch } = require('./game');
const CONFIG = require('../shared/game-config');

const lobbies = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code() {
  let value;
  do value = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  while (lobbies.has(value));
  return value;
}

function createLobby(player, mapId) {
  const lobby = { code: code(), players: [player], spectators: [], mapId, match: null };
  lobbies.set(lobby.code, lobby);
  return lobby;
}

function nameIsTaken(lobby, name) {
  const normalizedName = name.toLowerCase();
  return [...lobby.players, ...lobby.spectators]
    .some((member) => member.name.toLowerCase() === normalizedName);
}

function joinLobby(lobbyCode, player) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return { error: 'Lobby not found.' };
  if (lobby.players.length >= 2) return { error: 'Lobby is full.' };
  if (nameIsTaken(lobby, player.name)) return { error: 'Choose a different display name.' };
  lobby.players.push(player);
  lobby.match = createMatch(lobby.players, lobby.mapId);
  return { lobby };
}

function spectateLobby(lobbyCode, spectator) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return { error: 'Lobby not found.' };
  if (lobby.spectators.length >= CONFIG.maxSpectatorsPerLobby) return { error: 'This lobby has too many spectators.' };
  if (nameIsTaken(lobby, spectator.name)) return { error: 'Choose a different display name.' };
  lobby.spectators.push(spectator);
  return { lobby };
}

function removePlayer(lobby, playerId) {
  lobby.players = lobby.players.filter((player) => player.id !== playerId);
  if (!lobby.players.length) lobbies.delete(lobby.code);
}

function removeSpectator(lobby, spectatorId) {
  lobby.spectators = lobby.spectators.filter((spectator) => spectator.id !== spectatorId);
}

module.exports = { lobbies, createLobby, joinLobby, spectateLobby, removePlayer, removeSpectator };
