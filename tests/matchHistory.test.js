import { describe, expect, it } from 'vitest';
import {
  FLEET,
  createGame,
  fireShot,
  placeShip,
  startGame,
} from '../src/engine/gameLogic.js';
import {
  HISTORY_STORAGE_KEY,
  HistoryError,
  clearMatchHistory,
  loadMatchHistory,
  saveMatch,
} from '../src/history/matchHistory.js';
import { getReplayCursor, getReplayPlayer } from '../src/history/replay.js';

function createFinishedMatch(id = 'match-1') {
  let game = createGame(['captain', 'computer']);
  for (const player of game.players) {
    for (const [row, ship] of FLEET.entries()) {
      game = placeShip(game, player.id, ship.id, { row, column: 0 }, 'horizontal');
    }
  }
  game = startGame(game, () => 0);
  const shotLog = [];
  for (const ship of game.players[1].ships) {
    for (const position of ship.cells) {
      const result = fireShot(game, 'captain', 'computer', position);
      game = result.game;
      shotLog.push({
        shooterId: 'captain',
        targetId: 'computer',
        ...position,
        result: result.shot.result,
        shipId: result.shot.shipId,
        shipName: result.shot.shipName,
      });
    }
  }
  return {
    id,
    createdAt: '2026-10-15T12:00:00.000Z',
    difficulty: 'medium',
    game,
    shotLog,
  };
}

function createStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[HISTORY_STORAGE_KEY, initial]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('completed match history', () => {
  it('saves and restores a completed game across storage reads', () => {
    const storage = createStorage();
    const match = createFinishedMatch();

    expect(saveMatch(match, storage)).toEqual([match]);
    expect(loadMatchHistory(storage)).toEqual([match]);
  });

  it('keeps only the ten most recent matches', () => {
    const storage = createStorage();
    for (let index = 0; index < 12; index += 1) {
      saveMatch(createFinishedMatch(`match-${index}`), storage);
    }

    expect(loadMatchHistory(storage).map(({ id }) => id)).toEqual([
      'match-11', 'match-10', 'match-9', 'match-8', 'match-7',
      'match-6', 'match-5', 'match-4', 'match-3', 'match-2',
    ]);
  });

  it('replaces a match with the same ID and clears history', () => {
    const storage = createStorage();
    const match = createFinishedMatch();
    saveMatch(match, storage);
    saveMatch({ ...match, difficulty: 'hard' }, storage);

    expect(loadMatchHistory(storage)).toHaveLength(1);
    expect(loadMatchHistory(storage)[0].difficulty).toBe('hard');
    clearMatchHistory(storage);
    expect(loadMatchHistory(storage)).toEqual([]);
  });

  it.each([
    '{broken json',
    JSON.stringify({ matches: [] }),
    JSON.stringify([{ id: 'old-match' }]),
  ])('reports malformed or outdated stored data: %s', (raw) => {
    expect(() => loadMatchHistory(createStorage(raw))).toThrow(HistoryError);
  });

  it('reports browser storage failures instead of silently returning success', () => {
    const storage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(() => loadMatchHistory(storage)).toThrow(HistoryError);
    expect(() => saveMatch(createFinishedMatch(), storage)).toThrow(HistoryError);
    expect(() => clearMatchHistory(storage)).toThrow(HistoryError);
  });
});

describe('match replay navigation', () => {
  it('steps backward and forward within the recorded shot range', () => {
    expect(getReplayCursor(0, 5, -1)).toBe(0);
    expect(getReplayCursor(0, 5, 1)).toBe(1);
    expect(getReplayCursor(4, 5, 1)).toBe(5);
    expect(getReplayCursor(5, 5, 1)).toBe(5);
  });

  it('reconstructs each board from only the shots played so far', () => {
    const match = createFinishedMatch();
    expect(getReplayPlayer(match, 'computer', 0).shots).toEqual([]);
    expect(getReplayPlayer(match, 'computer', 2).shots).toEqual(
      match.shotLog.slice(0, 2).map(({
        row, column, result, shipId, shipName,
      }) => ({ row, column, result, shipId, shipName })),
    );
    expect(() => getReplayPlayer(match, 'unknown', 1)).toThrow('Unknown replay player');
  });
});
