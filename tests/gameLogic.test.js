import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_SIZE,
  FLEET,
  RuleError,
  clearFleet,
  createGame,
  fireShot,
  placeShip,
  randomizeFleet,
  startGame,
} from '../src/engine/gameLogic.js';

function expectRule(action, code) {
  expect(action).toThrow(RuleError);
  expect(action).toThrow(expect.objectContaining({ code }));
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function readyGame() {
  let game = createGame(['alice', 'bob']);
  for (const player of game.players) {
    for (const [row, ship] of FLEET.entries()) {
      game = placeShip(game, player.id, ship.id, { row, column: 0 }, 'horizontal');
    }
  }
  return freeze(game);
}

function playingGame() {
  return freeze(startGame(readyGame(), () => 0));
}

function expectLegalFleet(player) {
  expect(player.ships.map(({ id }) => id)).toEqual(FLEET.map(({ id }) => id));
  const occupied = new Set();
  for (const [index, ship] of player.ships.entries()) {
    expect(ship.cells).toHaveLength(FLEET[index].length);
    expect(ship.length).toBe(FLEET[index].length);
    expect(ship.name).toBe(FLEET[index].name);
    for (const [offset, cell] of ship.cells.entries()) {
      expect(Number.isInteger(cell.row)).toBe(true);
      expect(Number.isInteger(cell.column)).toBe(true);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(BOARD_SIZE);
      expect(cell.column).toBeGreaterThanOrEqual(0);
      expect(cell.column).toBeLessThan(BOARD_SIZE);
      expect(cell.row).toBe(ship.cells[0].row + (ship.orientation === 'vertical' ? offset : 0));
      expect(cell.column).toBe(
        ship.cells[0].column + (ship.orientation === 'horizontal' ? offset : 0),
      );
      const key = `${cell.row},${cell.column}`;
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
    }
  }
  expect(occupied.size).toBe(17);
}

describe('game creation', () => {
  it('creates independent empty two-player setup state', () => {
    const game = createGame();
    expect(game).toEqual({
      phase: 'setup',
      players: [
        { id: 'player-1', ships: [], shots: [] },
        { id: 'player-2', ships: [], shots: [] },
      ],
      firstPlayerId: null,
      currentPlayerId: null,
      winnerId: null,
    });
    expect(game.players[0].ships).not.toBe(game.players[1].ships);
    expect(game.players[0].shots).not.toBe(game.players[1].shots);
  });

  it.each([
    null, [], ['alice'], ['alice', 'bob', 'charlie'], ['alice', 'alice'],
    ['', 'bob'], [' ', 'bob'], [1, 'bob'], 'alice,bob',
  ])('rejects unsupported player IDs: %j', (ids) => {
    expectRule(() => createGame(ids), 'INVALID_PLAYERS');
  });
});

describe('manual fleet setup', () => {
  it('places horizontal and vertical ships exactly up to the board edges', () => {
    const original = freeze(createGame());
    const horizontal = placeShip(
      original, 'player-1', 'carrier', { row: 9, column: 5 }, 'horizontal',
    );
    const game = placeShip(
      horizontal, 'player-1', 'battleship', { row: 6, column: 0 }, 'vertical',
    );
    expect(game.players[0].ships[0].cells).toEqual(
      [5, 6, 7, 8, 9].map((column) => ({ row: 9, column })),
    );
    expect(game.players[0].ships[1].cells).toEqual(
      [6, 7, 8, 9].map((row) => ({ row, column: 0 })),
    );
    expect(original.players[0].ships).toEqual([]);
    expect(horizontal.players[0].ships).toHaveLength(1);
    expect(game.players[1]).toBe(original.players[1]);
  });

  it('allows edge and diagonal touching', () => {
    let game = createGame();
    game = placeShip(game, 'player-1', 'carrier', { row: 0, column: 0 }, 'horizontal');
    game = placeShip(game, 'player-1', 'battleship', { row: 1, column: 0 }, 'horizontal');
    game = placeShip(game, 'player-1', 'cruiser', { row: 2, column: 4 }, 'horizontal');
    expect(game.players[0].ships).toHaveLength(3);
  });

  it.each([
    [{ row: 0, column: 6 }, 'horizontal'],
    [{ row: 6, column: 0 }, 'vertical'],
  ])('rejects off-board ship extents: %j %s', (position, orientation) => {
    expectRule(
      () => placeShip(createGame(), 'player-1', 'carrier', position, orientation),
      'INVALID_PLACEMENT',
    );
  });

  it.each([
    null, {}, { row: -1, column: 0 }, { row: 0, column: -1 },
    { row: 10, column: 0 }, { row: 0, column: 10 },
    { row: 0.5, column: 0 }, { row: 0, column: 0.5 },
    { row: '0', column: 0 }, { row: NaN, column: 0 }, { row: 0, column: Infinity },
  ])('rejects invalid placement coordinates: %j', (position) => {
    expectRule(
      () => placeShip(createGame(), 'player-1', 'carrier', position, 'horizontal'),
      'INVALID_POSITION',
    );
  });

  it('rejects overlap and duplicate ships without modifying setup', () => {
    const game = freeze(placeShip(
      createGame(), 'player-1', 'carrier', { row: 0, column: 0 }, 'horizontal',
    ));
    expectRule(
      () => placeShip(game, 'player-1', 'destroyer', { row: 0, column: 4 }, 'vertical'),
      'INVALID_PLACEMENT',
    );
    expectRule(
      () => placeShip(game, 'player-1', 'carrier', { row: 5, column: 0 }, 'horizontal'),
      'SHIP_ALREADY_PLACED',
    );
    expect(game.players[0].ships).toHaveLength(1);
  });

  it('rejects unknown players, ships and orientations', () => {
    const game = createGame();
    const position = { row: 0, column: 0 };
    expectRule(
      () => placeShip(game, 'missing', 'carrier', position, 'horizontal'), 'INVALID_PLAYER',
    );
    expectRule(
      () => placeShip(game, 'player-1', 'boat', position, 'horizontal'), 'INVALID_SHIP',
    );
    expectRule(
      () => placeShip(game, 'player-1', 'carrier', position, 'diagonal'), 'INVALID_ORIENTATION',
    );
    expectRule(() => clearFleet(game, 'missing'), 'INVALID_PLAYER');
    expectRule(() => randomizeFleet(game, 'missing'), 'INVALID_PLAYER');
  });

  it('clears only the selected fleet and allows rebuilding it', () => {
    const original = readyGame();
    const cleared = clearFleet(original, 'alice');
    expect(cleared.players[0].ships).toEqual([]);
    expect(cleared.players[1]).toBe(original.players[1]);
    expect(original.players[0].ships).toHaveLength(5);
    const rebuilt = placeShip(cleared, 'alice', 'carrier', { row: 0, column: 0 }, 'vertical');
    expect(rebuilt.players[0].ships).toHaveLength(1);
  });
});

describe('random fleet setup', () => {
  it.each([0, 0.5, 1 - Number.EPSILON])(
    'produces a complete legal replacement fleet with random value %s', (value) => {
      const original = readyGame();
      const random = vi.fn(() => value);
      const game = randomizeFleet(original, 'alice', random);
      expectLegalFleet(game.players[0]);
      expect(random).toHaveBeenCalledTimes(FLEET.length);
      expect(game.players[1]).toBe(original.players[1]);
      expect(original.players[0].ships[0].orientation).toBe('horizontal');
    },
  );

  it('produces legal fleets across 100 production-random samples', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const game = randomizeFleet(freeze(createGame()), 'player-1');
      expectLegalFleet(game.players[0]);
    }
  });

  it.each([-0.1, 1, NaN, Infinity, '0.5', undefined])(
    'rejects an invalid random value: %s', (value) => {
      expectRule(
        () => randomizeFleet(createGame(), 'player-1', () => value), 'INVALID_RANDOM',
      );
      expectRule(() => startGame(readyGame(), () => value), 'INVALID_RANDOM');
    },
  );

  it('rejects a non-function random source', () => {
    expectRule(() => randomizeFleet(createGame(), 'player-1', null), 'INVALID_RANDOM');
    expectRule(() => startGame(readyGame(), null), 'INVALID_RANDOM');
  });
});

describe('starting a game', () => {
  it('requires complete fleets for both players', () => {
    expectRule(() => startGame(createGame()), 'INCOMPLETE_FLEET');
    expectRule(() => startGame(clearFleet(readyGame(), 'bob')), 'INCOMPLETE_FLEET');
  });

  it.each([[0, 'alice'], [0.499, 'alice'], [0.5, 'bob'], [1 - Number.EPSILON, 'bob']])(
    'chooses %s as random sample and announces first player %s before any shots', (value, id) => {
      const original = readyGame();
      const game = startGame(original, () => value);
      expect(game.phase).toBe('playing');
      expect(game.firstPlayerId).toBe(id);
      expect(game.currentPlayerId).toBe(id);
      expect(game.winnerId).toBeNull();
      expect(game.players.every((player) => player.shots.length === 0)).toBe(true);
      expect(original.phase).toBe('setup');
    },
  );

  it('uses ordinary Math.random by default', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.75);
    try {
      expect(startGame(readyGame()).firstPlayerId).toBe('bob');
      expect(random).toHaveBeenCalledTimes(1);
    } finally {
      random.mockRestore();
    }
  });

  it('prevents starting again or changing setup during play', () => {
    const game = playingGame();
    expectRule(() => startGame(game), 'INVALID_PHASE');
    expectRule(() => clearFleet(game, 'alice'), 'INVALID_PHASE');
    expectRule(() => randomizeFleet(game, 'alice'), 'INVALID_PHASE');
    expectRule(
      () => placeShip(game, 'alice', 'carrier', { row: 0, column: 0 }, 'horizontal'),
      'INVALID_PHASE',
    );
  });
});

describe('shots and turns', () => {
  it('sinks a vertical ship with hits in any order', () => {
    let game = clearFleet(readyGame(), 'bob');
    for (const [column, ship] of FLEET.entries()) {
      game = placeShip(game, 'bob', ship.id, { row: 0, column }, 'vertical');
    }
    game = startGame(game, () => 0);
    for (const row of [2, 4, 0, 3]) {
      const result = fireShot(freeze(game), 'alice', 'bob', { row, column: 0 });
      expect(result.shot.result).toBe('hit');
      game = result.game;
    }
    const result = fireShot(freeze(game), 'alice', 'bob', { row: 1, column: 0 });
    expect(result.shot.result).toBe('sunk');
    expect(result.shot.shipName).toBe('Carrier');
    expect(result.game.currentPlayerId).toBe('alice');
  });

  it('retains the turn on hit and sink, reports the sunk name, then switches on miss', () => {
    const original = playingGame();
    const hit = fireShot(original, 'alice', 'bob', { row: 4, column: 0 });
    expect(hit.shot).toEqual({
      row: 4, column: 0, result: 'hit', shipId: 'destroyer', shipName: null,
    });
    expect(hit.game.currentPlayerId).toBe('alice');
    const sunk = fireShot(freeze(hit.game), 'alice', 'bob', { row: 4, column: 1 });
    expect(sunk.shot).toEqual({
      row: 4, column: 1, result: 'sunk', shipId: 'destroyer', shipName: 'Destroyer',
    });
    expect(sunk.game.phase).toBe('playing');
    expect(sunk.game.currentPlayerId).toBe('alice');
    const miss = fireShot(freeze(sunk.game), 'alice', 'bob', { row: 9, column: 9 });
    expect(miss.shot).toEqual({
      row: 9, column: 9, result: 'miss', shipId: null, shipName: null,
    });
    expect(miss.game.currentPlayerId).toBe('bob');
    expect(miss.game.firstPlayerId).toBe('alice');
    expect(miss.game.players[1].shots).toHaveLength(3);
    expect(original.players[1].shots).toEqual([]);
    expect(hit.game.players[1].shots).toHaveLength(1);
  });

  it.each([
    { row: 4, column: 0 },
    { row: 9, column: 9 },
  ])('rejects repeated hits or misses without consuming turn: %j', (position) => {
    let { game } = fireShot(playingGame(), 'alice', 'bob', position);
    if (game.currentPlayerId === 'bob') {
      ({ game } = fireShot(game, 'bob', 'alice', { row: 9, column: 9 }));
    }
    freeze(game);
    const before = structuredClone(game);
    expectRule(() => fireShot(game, 'alice', 'bob', position), 'ALREADY_TARGETED');
    expect(game).toEqual(before);
    expect(game.currentPlayerId).toBe('alice');
    expect(fireShot(game, 'alice', 'bob', { row: 9, column: 8 }).game.currentPlayerId).toBe('bob');
  });

  it('rejects targeting an already sunk ship without consuming turn', () => {
    let { game } = fireShot(playingGame(), 'alice', 'bob', { row: 4, column: 0 });
    ({ game } = fireShot(game, 'alice', 'bob', { row: 4, column: 1 }));
    freeze(game);
    expectRule(
      () => fireShot(game, 'alice', 'bob', { row: 4, column: 1 }), 'ALREADY_TARGETED',
    );
    expect(game.currentPlayerId).toBe('alice');
    expect(game.players[1].shots).toHaveLength(2);
  });

  it('allows the same coordinates on different boards', () => {
    const first = fireShot(playingGame(), 'alice', 'bob', { row: 9, column: 9 });
    const second = fireShot(first.game, 'bob', 'alice', { row: 9, column: 9 });
    expect(second.game.currentPlayerId).toBe('alice');
    expect(second.game.players.map((player) => player.shots.length)).toEqual([1, 1]);
  });

  it.each([
    null, {}, { row: -1, column: 0 }, { row: 0, column: -1 },
    { row: 10, column: 0 }, { row: 0, column: 10 },
    { row: 0.1, column: 0 }, { row: 0, column: 0.1 },
    { row: '0', column: 0 }, { row: Infinity, column: 0 }, { row: 0, column: NaN },
  ])('rejects invalid shot coordinates without changing state: %j', (position) => {
    const game = playingGame();
    const before = structuredClone(game);
    expectRule(() => fireShot(game, 'alice', 'bob', position), 'INVALID_POSITION');
    expect(game).toEqual(before);
  });

  it('rejects setup shots, wrong turns, self-targeting and unknown players', () => {
    const position = { row: 0, column: 0 };
    expectRule(() => fireShot(readyGame(), 'alice', 'bob', position), 'INVALID_PHASE');
    const game = playingGame();
    expectRule(() => fireShot(game, 'bob', 'alice', position), 'NOT_YOUR_TURN');
    expectRule(() => fireShot(game, 'alice', 'alice', position), 'INVALID_TARGET');
    expectRule(() => fireShot(game, 'missing', 'bob', position), 'INVALID_PLAYER');
    expectRule(() => fireShot(game, 'alice', 'missing', position), 'INVALID_PLAYER');
    expect(game.players.every((player) => player.shots.length === 0)).toBe(true);
    expect(game.currentPlayerId).toBe('alice');
  });

  it.each(['alice', 'bob'])('ends immediately on the final sink with winner %s', (shooter) => {
    let game = freeze(startGame(readyGame(), () => (shooter === 'alice' ? 0 : 0.99)));
    const target = shooter === 'alice' ? 'bob' : 'alice';
    const ships = game.players.find(({ id }) => id === target).ships;
    const sunkNames = [];
    let shotCount = 0;
    for (const ship of ships) {
      for (const position of ship.cells) {
        const result = fireShot(game, shooter, target, position);
        game = freeze(result.game);
        shotCount += 1;
        if (result.shot.result === 'sunk') sunkNames.push(result.shot.shipName);
        if (shotCount < 17) {
          expect(game.phase).toBe('playing');
          expect(game.winnerId).toBeNull();
          expect(game.currentPlayerId).toBe(shooter);
        }
      }
    }
    expect(sunkNames).toEqual(FLEET.map(({ name }) => name));
    expect(shotCount).toBe(17);
    expect(game.phase).toBe('finished');
    expect(game.winnerId).toBe(shooter);
    expect(game.currentPlayerId).toBeNull();
    expect(game.firstPlayerId).toBe(shooter);
    expectRule(() => fireShot(game, shooter, target, { row: 9, column: 9 }), 'INVALID_PHASE');
    expectRule(() => clearFleet(game, shooter), 'INVALID_PHASE');
    expectRule(() => randomizeFleet(game, shooter), 'INVALID_PHASE');
    expectRule(() => startGame(game), 'INVALID_PHASE');
  });

  it('plays randomized fleets to completion with misses, turn changes and sinks', () => {
    let game = createGame(['alice', 'bob']);
    game = randomizeFleet(game, 'alice');
    game = randomizeFleet(game, 'bob');
    game = startGame(game);
    let shotCount = 0;
    while (game.phase === 'playing' && shotCount < 200) {
      const shooter = game.currentPlayerId;
      const target = game.players.find(({ id }) => id !== shooter);
      const positions = Array.from({ length: 100 }, (_, index) => ({
        row: Math.floor(index / 10),
        column: index % 10,
      }));
      const position = positions.find((cell) => !target.shots.some((shot) => (
        shot.row === cell.row && shot.column === cell.column
      )));
      const result = fireShot(freeze(game), shooter, target.id, position);
      game = result.game;
      shotCount += 1;
    }
    expect(game.phase).toBe('finished');
    expect(shotCount).toBeLessThanOrEqual(199);
    expect(game.players.map(({ id }) => id)).toContain(game.winnerId);
    const loser = game.players.find(({ id }) => id !== game.winnerId);
    expect(loser.shots.filter(({ shipId }) => shipId !== null)).toHaveLength(17);
    expect(loser.shots.filter(({ result }) => result === 'sunk')).toHaveLength(5);
  });
});
