import { BOARD_SIZE, FLEET } from './gameLogic.js';

function randomIndex(length, random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random source must return a number in [0, 1).');
  }
  return Math.floor(value * length);
}

function cellKey({ row, column }) {
  return `${row},${column}`;
}

function randomChoice(cells, random) {
  if (cells.length === 0) throw new Error('No legal unshot targets remain.');
  return cells[randomIndex(cells.length, random)];
}

function getTargetState(game, playerId) {
  const player = game.players.find(({ id }) => id === playerId);
  if (!player) throw new Error(`Unknown AI player: ${playerId}`);
  const target = game.players.find(({ id }) => id !== playerId);
  if (!target) throw new Error('AI requires a two-player game.');
  const fired = new Set(target.shots.map(cellKey));
  const sunkShips = new Set(
    target.shots.filter(({ result }) => result === 'sunk').map(({ shipId }) => shipId),
  );
  const blocked = new Set(target.shots
    .filter(({ result, shipId }) => (
      result === 'miss' || (shipId !== null && sunkShips.has(shipId))
    ))
    .map(cellKey));
  const unresolvedHits = target.shots.filter(({ result, shipId }) => (
    result === 'hit' && !sunkShips.has(shipId)
  ));
  const remainingLengths = FLEET
    .filter(({ id }) => !sunkShips.has(id))
    .map(({ length }) => length);
  const unshot = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      const position = { row, column };
      if (!fired.has(cellKey(position))) unshot.push(position);
    }
  }
  return { fired, blocked, unresolvedHits, remainingLengths, unshot };
}

function getHuntTargets(unresolvedHits, fired) {
  const targets = new Map();
  for (const hit of unresolvedHits) {
    for (const position of [
      { row: hit.row - 1, column: hit.column },
      { row: hit.row + 1, column: hit.column },
      { row: hit.row, column: hit.column - 1 },
      { row: hit.row, column: hit.column + 1 },
    ]) {
      if (position.row >= 0 && position.row < BOARD_SIZE
        && position.column >= 0 && position.column < BOARD_SIZE
        && !fired.has(cellKey(position))) {
        targets.set(cellKey(position), position);
      }
    }
  }
  return [...targets.values()];
}

function getProbabilityScores(remainingLengths, blocked, unshot) {
  const scores = new Map(unshot.map((position) => [cellKey(position), 0]));
  for (const length of remainingLengths) {
    for (const orientation of ['horizontal', 'vertical']) {
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let column = 0; column < BOARD_SIZE; column += 1) {
          const cells = Array.from({ length }, (_, offset) => ({
            row: row + (orientation === 'vertical' ? offset : 0),
            column: column + (orientation === 'horizontal' ? offset : 0),
          }));
          if (cells.some(({ row: r, column: c }) => (
            r >= BOARD_SIZE || c >= BOARD_SIZE || blocked.has(`${r},${c}`)
          ))) continue;
          for (const cell of cells) {
            const key = cellKey(cell);
            if (scores.has(key)) scores.set(key, scores.get(key) + 1);
          }
        }
      }
    }
  }
  return scores;
}

export function chooseAiShot(game, playerId, difficulty = 'medium', random = Math.random) {
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new RangeError(`Unknown AI difficulty: ${difficulty}`);
  }
  const { fired, blocked, unresolvedHits, remainingLengths, unshot } = getTargetState(
    game, playerId,
  );
  if (unshot.length === 0) throw new Error('No legal unshot targets remain.');

  if (difficulty === 'easy') return randomChoice(unshot, random);

  const huntTargets = getHuntTargets(unresolvedHits, fired);
  if (difficulty === 'medium' && huntTargets.length > 0) {
    return randomChoice(huntTargets, random);
  }

  const scores = getProbabilityScores(remainingLengths, blocked, unshot);
  if (difficulty === 'hard') {
    const highestScore = Math.max(...scores.values());
    return randomChoice(
      unshot.filter((position) => scores.get(cellKey(position)) === highestScore),
      random,
    );
  }
  return randomChoice(unshot, random);
}
