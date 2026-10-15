export const BOARD_SIZE = 10;

export const FLEET = Object.freeze([
  Object.freeze({ id: 'carrier', name: 'Carrier', length: 5 }),
  Object.freeze({ id: 'battleship', name: 'Battleship', length: 4 }),
  Object.freeze({ id: 'cruiser', name: 'Cruiser', length: 3 }),
  Object.freeze({ id: 'submarine', name: 'Submarine', length: 3 }),
  Object.freeze({ id: 'destroyer', name: 'Destroyer', length: 2 }),
]);

export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}

function requireRule(condition, code, message) {
  if (!condition) throw new RuleError(code, message);
}

function requirePhase(game, phase) {
  requireRule(game.phase === phase, 'INVALID_PHASE', `Game must be in ${phase} phase.`);
}

function getPlayer(game, playerId) {
  const player = game.players.find((entry) => entry.id === playerId);
  requireRule(player, 'INVALID_PLAYER', 'Unknown player ID.');
  return player;
}

function requirePosition(position) {
  requireRule(
    position != null
      && Number.isInteger(position.row)
      && Number.isInteger(position.column)
      && position.row >= 0 && position.row < BOARD_SIZE
      && position.column >= 0 && position.column < BOARD_SIZE,
    'INVALID_POSITION',
    'Position must have integer row and column coordinates from 0 to 9.',
  );
}

function sameCell(left, right) {
  return left.row === right.row && left.column === right.column;
}

function shipCells(ship, position, orientation) {
  return Array.from({ length: ship.length }, (_, offset) => ({
    row: position.row + (orientation === 'vertical' ? offset : 0),
    column: position.column + (orientation === 'horizontal' ? offset : 0),
  }));
}

function fits(ships, cells) {
  return cells.every((cell) => cell.row < BOARD_SIZE && cell.column < BOARD_SIZE
    && !ships.some((ship) => ship.cells.some((occupied) => sameCell(cell, occupied))));
}

function replacePlayer(game, updatedPlayer) {
  return {
    ...game,
    players: game.players.map((player) => (
      player.id === updatedPlayer.id ? updatedPlayer : player
    )),
  };
}

function randomIndex(length, random) {
  requireRule(typeof random === 'function', 'INVALID_RANDOM', 'Random source must be a function.');
  const value = random();
  requireRule(
    Number.isFinite(value) && value >= 0 && value < 1,
    'INVALID_RANDOM',
    'Random source must return a number in [0, 1).',
  );
  return Math.floor(value * length);
}

export function createGame(playerIds = ['player-1', 'player-2']) {
  requireRule(
    Array.isArray(playerIds) && playerIds.length === 2
      && playerIds.every((id) => typeof id === 'string' && id.trim().length > 0)
      && new Set(playerIds).size === 2,
    'INVALID_PLAYERS',
    'Exactly two distinct, nonempty player IDs are required.',
  );
  return {
    phase: 'setup',
    players: playerIds.map((id) => ({ id, ships: [], shots: [] })),
    firstPlayerId: null,
    currentPlayerId: null,
    winnerId: null,
  };
}

export function placeShip(game, playerId, shipId, position, orientation) {
  requirePhase(game, 'setup');
  const player = getPlayer(game, playerId);
  const ship = FLEET.find((entry) => entry.id === shipId);
  requireRule(ship, 'INVALID_SHIP', 'Unknown fleet ship ID.');
  requireRule(
    !player.ships.some((entry) => entry.id === shipId),
    'SHIP_ALREADY_PLACED',
    'Clear the fleet before placing an existing ship again.',
  );
  requirePosition(position);
  requireRule(
    orientation === 'horizontal' || orientation === 'vertical',
    'INVALID_ORIENTATION',
    'Orientation must be horizontal or vertical.',
  );
  const cells = shipCells(ship, position, orientation);
  requireRule(
    fits(player.ships, cells),
    'INVALID_PLACEMENT',
    'Ship must stay on the board and cannot overlap another ship.',
  );
  return replacePlayer(game, {
    ...player,
    ships: [...player.ships, { ...ship, orientation, cells }],
  });
}

export function clearFleet(game, playerId) {
  requirePhase(game, 'setup');
  const player = getPlayer(game, playerId);
  return replacePlayer(game, { ...player, ships: [] });
}

export function moveShip(game, playerId, shipId, position, orientation) {
  requirePhase(game, 'setup');
  const player = getPlayer(game, playerId);
  requireRule(player.ships.some((ship) => ship.id === shipId),
    'SHIP_NOT_PLACED', 'Place this ship before moving it.');
  const withoutShip = replacePlayer(game, {
    ...player,
    ships: player.ships.filter((ship) => ship.id !== shipId),
  });
  return placeShip(withoutShip, playerId, shipId, position, orientation);
}

export function rotateShip(game, playerId, shipId) {
  requirePhase(game, 'setup');
  const player = getPlayer(game, playerId);
  const ship = player.ships.find((entry) => entry.id === shipId);
  requireRule(ship, 'SHIP_NOT_PLACED', 'Place this ship before rotating it.');
  const orientation = ship.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  const others = player.ships.filter((entry) => entry.id !== shipId);
  const origin = ship.cells[0];
  const positions = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const position = { row, column };
      if (fits(others, shipCells(ship, position, orientation))) positions.push(position);
    }
  }
  positions.sort((a, b) => (
    Math.abs(a.row - origin.row) + Math.abs(a.column - origin.column)
    - Math.abs(b.row - origin.row) - Math.abs(b.column - origin.column)
  ));
  requireRule(positions.length, 'NO_LEGAL_PLACEMENT', 'No space is available to rotate this ship.');
  return moveShip(game, playerId, shipId, positions[0], orientation);
}

export function randomizeFleet(game, playerId, random = Math.random) {
  requirePhase(game, 'setup');
  const player = getPlayer(game, playerId);
  const ships = [];
  for (const ship of FLEET) {
    const placements = [];
    for (const orientation of ['horizontal', 'vertical']) {
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let column = 0; column < BOARD_SIZE; column += 1) {
          const cells = shipCells(ship, { row, column }, orientation);
          if (fits(ships, cells)) placements.push({ ...ship, orientation, cells });
        }
      }
    }
    requireRule(placements.length > 0, 'NO_LEGAL_PLACEMENT', 'No legal fleet placement remains.');
    ships.push(placements[randomIndex(placements.length, random)]);
  }
  return replacePlayer(game, { ...player, ships });
}

export function startGame(game, random = Math.random) {
  requirePhase(game, 'setup');
  requireRule(
    game.players.every((player) => FLEET.every((ship) => (
      player.ships.some((placed) => placed.id === ship.id)
    ))),
    'INCOMPLETE_FLEET',
    'Both players must place their complete fleet before starting.',
  );
  const firstPlayerId = game.players[randomIndex(game.players.length, random)].id;
  return { ...game, phase: 'playing', firstPlayerId, currentPlayerId: firstPlayerId };
}

export function fireShot(game, shooterId, targetId, position) {
  requirePhase(game, 'playing');
  getPlayer(game, shooterId);
  const target = getPlayer(game, targetId);
  requireRule(shooterId !== targetId, 'INVALID_TARGET', 'A player cannot shoot their own board.');
  requireRule(game.currentPlayerId === shooterId, 'NOT_YOUR_TURN', 'It is not this player\'s turn.');
  requirePosition(position);
  requireRule(
    !target.shots.some((shot) => sameCell(shot, position)),
    'ALREADY_TARGETED',
    'This cell has already been targeted.',
  );

  const ship = target.ships.find((entry) => entry.cells.some((cell) => sameCell(cell, position)));
  const sunk = ship && ship.cells.every((cell) => sameCell(cell, position)
    || target.shots.some((shot) => sameCell(shot, cell)));
  const shot = {
    row: position.row,
    column: position.column,
    result: ship ? (sunk ? 'sunk' : 'hit') : 'miss',
    shipId: ship?.id ?? null,
    shipName: sunk ? ship.name : null,
  };
  const updatedTarget = { ...target, shots: [...target.shots, shot] };
  const won = Boolean(sunk && target.ships.every((entry) => entry.cells.every((cell) => (
    updatedTarget.shots.some((previous) => sameCell(previous, cell))
  ))));
  const updatedGame = replacePlayer(game, updatedTarget);
  return {
    game: {
      ...updatedGame,
      phase: won ? 'finished' : 'playing',
      currentPlayerId: won ? null : (ship ? shooterId : targetId),
      winnerId: won ? shooterId : null,
    },
    shot,
  };
}
