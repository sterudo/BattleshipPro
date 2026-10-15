import { describe, expect, it } from 'vitest';
import { chooseAiShot } from '../src/engine/ai.js';

function gameWithShots(shots = []) {
  return {
    players: [
      { id: 'captain', ships: [], shots },
      { id: 'computer', ships: [], shots: [] },
    ],
  };
}

describe('built-in AI target selection', () => {
  it.each(['easy', 'medium', 'hard'])('chooses an unshot board cell on %s', (difficulty) => {
    const shots = [
      { row: 0, column: 0, result: 'miss', shipId: null },
      { row: 0, column: 1, result: 'hit', shipId: 'carrier' },
    ];
    const game = gameWithShots(shots);
    const target = chooseAiShot(game, 'computer', difficulty, () => 0);

    expect(target.row).toBeGreaterThanOrEqual(0);
    expect(target.row).toBeLessThan(10);
    expect(target.column).toBeGreaterThanOrEqual(0);
    expect(target.column).toBeLessThan(10);
    expect(shots).not.toContainEqual(expect.objectContaining(target));
    if (difficulty === 'easy') expect(target).toEqual({ row: 0, column: 2 });
    expect(game.players[0].shots).toHaveLength(2);
  });

  it('uses adjacent hunt targets after an unresolved hit on Medium', () => {
    const target = chooseAiShot(gameWithShots([
      { row: 5, column: 5, result: 'hit', shipId: 'cruiser' },
      { row: 4, column: 5, result: 'miss', shipId: null },
      { row: 5, column: 4, result: 'miss', shipId: null },
    ]), 'computer', 'medium', () => 0);

    expect(target).toEqual({ row: 6, column: 5 });
  });

  it('does not continue hunting around a ship after it has been sunk', () => {
    const target = chooseAiShot(gameWithShots([
      { row: 5, column: 5, result: 'hit', shipId: 'destroyer' },
      { row: 5, column: 6, result: 'sunk', shipId: 'destroyer' },
    ]), 'computer', 'medium', () => 0);

    expect(target).toEqual({ row: 0, column: 0 });
  });

  it('uses remaining-ship placement counts for Hard targeting', () => {
    const sunkShips = ['battleship', 'cruiser', 'submarine', 'destroyer'];
    const shots = sunkShips.map((shipId, index) => ({
      row: index,
      column: 0,
      result: 'sunk',
      shipId,
    }));
    const target = chooseAiShot(gameWithShots(shots), 'computer', 'hard', () => 0);

    expect([
      { row: 4, column: 4 },
      { row: 4, column: 5 },
      { row: 5, column: 4 },
      { row: 5, column: 5 },
    ]).toContainEqual(target);
  });

  it('rejects unsupported difficulty and invalid randomness', () => {
    expect(() => chooseAiShot(gameWithShots(), 'computer', 'impossible')).toThrow(RangeError);
    expect(() => chooseAiShot(gameWithShots(), 'computer', 'easy', () => 1)).toThrow(RangeError);
  });
});
