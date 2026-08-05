const { createMatch } = require('./game');

const lobbies = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code() {
  let value;
  do value = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  while (lobbies.has(value));
  return value;
}

function createLobby(player) {
  const lobby = { code: code(), players: [player], match: null };
  lobbies.set(lobby.code, lobby);
  return lobby;
}

function joinLobby(lobbyCode, player) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return { error: 'Lobby not found.' };
  if (lobby.players.length >= 2) return { error: 'Lobby is full.' };
  if (lobby.players.some((existing) => existing.name.toLowerCase() === player.name.toLowerCase())) return { error: 'Choose a different display name.' };
  lobby.players.push(player);
  lobby.match = createMatch(lobby.players);
  return { lobby };
}

function removePlayer(lobby, playerId) {
  lobby.players = lobby.players.filter((player) => player.id !== playerId);
  if (!lobby.players.length) lobbies.delete(lobby.code);
}

module.exports = { lobbies, createLobby, joinLobby, removePlayer };
