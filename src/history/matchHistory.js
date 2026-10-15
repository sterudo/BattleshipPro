import { FLEET } from '../engine/gameLogic.js';

export const HISTORY_STORAGE_KEY = 'fleet-command.matches.v1';
export const MAX_MATCHES = 10;

export class HistoryError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'HistoryError';
  }
}

function isPosition(value) {
  return value != null
    && Number.isInteger(value.row) && value.row >= 0 && value.row < 10
    && Number.isInteger(value.column) && value.column >= 0 && value.column < 10;
}

function isShot(value) {
  if (!isPosition(value) || !['miss', 'hit', 'sunk'].includes(value.result)) return false;
  if (value.result === 'miss') {
    return value.shipId === null && value.shipName === null;
  }
  if (typeof value.shipId !== 'string') return false;
  return value.result === 'hit'
    ? value.shipName === null
    : typeof value.shipName === 'string';
}

function validFleet(player) {
  if (!Array.isArray(player?.ships) || player.ships.length !== FLEET.length) return false;
  const occupied = new Set();
  for (const expected of FLEET) {
    const ship = player.ships.find((entry) => entry?.id === expected.id);
    if (!ship
      || ship.name !== expected.name
      || ship.length !== expected.length
      || !['horizontal', 'vertical'].includes(ship.orientation)
      || !Array.isArray(ship.cells)
      || ship.cells.length !== expected.length
      || !ship.cells.every(isPosition)) return false;
    const { row, column } = ship.cells[0];
    for (const [offset, cell] of ship.cells.entries()) {
      if (cell.row !== row + (ship.orientation === 'vertical' ? offset : 0)
        || cell.column !== column + (ship.orientation === 'horizontal' ? offset : 0)) {
        return false;
      }
      const key = `${cell.row},${cell.column}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return true;
}

function validateMatch(match) {
  const players = match?.game?.players;
  const mode = match?.mode ?? 'solo';
  const validPlayers = Array.isArray(players) && players.length === 2
    && players.every((player) => (
      typeof player?.id === 'string' && player.id.trim().length > 0
    ))
    && new Set(players.map((player) => player.id)).size === 2;
  const playerIds = validPlayers ? players.map(({ id }) => id) : [];
  const validPlayerNames = match?.playerNames === undefined
    || (match.playerNames != null
      && typeof match.playerNames === 'object'
      && (mode === 'local'
        ? playerIds.every((id) => typeof match.playerNames[id] === 'string'
          && match.playerNames[id].trim().length > 0)
          && new Set(playerIds.map((id) => match.playerNames[id].trim().toLowerCase())).size === 2
        : Object.values(match.playerNames).some((name) => (
          typeof name === 'string' && name.trim().length > 0
        ))));
  const validFleets = validPlayers && players.every(validFleet);
  const validShots = validFleets && players.every((player) => {
    if (!Array.isArray(player.shots)) return false;
    const fired = new Set();
    const sunkShips = new Set();
    for (const shot of player.shots) {
      if (!isShot(shot)) return false;
      const key = `${shot.row},${shot.column}`;
      if (fired.has(key)) return false;
      fired.add(key);
      const ship = player.ships.find(({ cells }) => (
        cells.some((cell) => cell.row === shot.row && cell.column === shot.column)
      ));
      if (shot.result === 'miss') {
        if (ship) return false;
        continue;
      }
      if (!ship || ship.id !== shot.shipId
        || (shot.result === 'sunk') !== ship.cells.every((cell) => (
          fired.has(`${cell.row},${cell.column}`)
        ))
        || sunkShips.has(ship.id)) return false;
      if (shot.result === 'sunk') sunkShips.add(ship.id);
    }
    return true;
  });
  const validLog = Array.isArray(match?.shotLog) && match.shotLog.length > 0
    && match.shotLog.every((entry) => (
      playerIds.includes(entry?.shooterId)
      && playerIds.includes(entry?.targetId)
      && entry?.shooterId !== entry?.targetId
      && isShot(entry)
  ));
  if (typeof match?.id !== 'string'
    || typeof match?.createdAt !== 'string'
    || Number.isNaN(Date.parse(match.createdAt))
    || !['solo', 'local'].includes(mode)
    || (mode === 'solo' && !['easy', 'medium', 'hard'].includes(match?.difficulty))
    || (mode === 'local' && match?.difficulty !== null)
    || !validPlayerNames
    || match?.game?.phase !== 'finished'
    || !playerIds.includes(match.game.winnerId)
    || !playerIds.includes(match.game.firstPlayerId)
    || match.game.currentPlayerId !== null
    || !validFleets || !validShots || !validLog
    || match.shotLog.length !== players.reduce((count, player) => count + player.shots.length, 0)
    || match.shotLog.at(-1).shooterId !== match.game.winnerId
    || match.shotLog.at(-1).result !== 'sunk') {
    throw new HistoryError('Saved match history contains invalid or outdated data.');
  }
  const shotIndex = new Map(playerIds.map((id) => [id, 0]));
  let expectedShooter = match.game.firstPlayerId;
  for (const entry of match.shotLog) {
    if (entry.shooterId !== expectedShooter) {
      throw new HistoryError('Saved match contains an invalid turn sequence.');
    }
    const target = players.find(({ id }) => id === entry.targetId);
    const targetShot = target.shots[shotIndex.get(target.id)];
    if (!targetShot || ['row', 'column', 'result', 'shipId', 'shipName']
      .some((key) => targetShot[key] !== entry[key])) {
      throw new HistoryError('Saved match replay does not match its board history.');
    }
    shotIndex.set(target.id, shotIndex.get(target.id) + 1);
    expectedShooter = entry.result === 'miss' ? entry.targetId : entry.shooterId;
  }
  const defeatedPlayer = players.find(({ id }) => id !== match.game.winnerId);
  const allDefeatedShipsSunk = defeatedPlayer.ships.every(({ cells }) => (
    cells.every((cell) => defeatedPlayer.shots.some((shot) => (
      shot.row === cell.row && shot.column === cell.column
    )))
  ));
  if (!allDefeatedShipsSunk) {
    throw new HistoryError('Saved match is not a completed fleet victory.');
  }
}

function getStorage(storage) {
  try {
    const availableStorage = storage ?? globalThis.localStorage;
    if (!availableStorage) throw new Error('Browser storage is unavailable.');
    return availableStorage;
  } catch (error) {
    throw new HistoryError('Could not access browser storage.', error);
  }
}

export function loadMatchHistory(storage) {
  const store = getStorage(storage);
  let raw;
  try {
    raw = store.getItem(HISTORY_STORAGE_KEY);
  } catch (error) {
    throw new HistoryError('Could not read match history from browser storage.', error);
  }
  if (raw === null) return [];
  let matches;
  try {
    matches = JSON.parse(raw);
  } catch (error) {
    throw new HistoryError('Saved match history is not valid JSON.', error);
  }
  if (!Array.isArray(matches)) {
    throw new HistoryError('Saved match history must be a list.');
  }
  matches.forEach(validateMatch);
  return matches.slice(0, MAX_MATCHES);
}

function writeMatchHistory(matches, storage) {
  const store = getStorage(storage);
  try {
    store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(matches));
  } catch (error) {
    throw new HistoryError('Could not save match history to browser storage.', error);
  }
}

export function saveMatch(match, storage) {
  validateMatch(match);
  const matches = loadMatchHistory(storage)
    .filter(({ id }) => id !== match.id);
  const updated = [match, ...matches].slice(0, MAX_MATCHES);
  writeMatchHistory(updated, storage);
  return updated;
}

export function clearMatchHistory(storage) {
  const store = getStorage(storage);
  try {
    store.removeItem(HISTORY_STORAGE_KEY);
  } catch (error) {
    throw new HistoryError('Could not clear match history from browser storage.', error);
  }
}
