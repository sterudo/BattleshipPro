import { describe, expect, it } from 'vitest';
import {
  PLAYER_NAMES_STORAGE_KEY,
  PLAYER_ONE_DEFAULT,
  PLAYER_PROGRESS_STORAGE_KEY,
  PlayerProgressError,
  getPlayerLeaderboard,
  loadPlayerNames,
  loadPlayerProgress,
  normalizePlayerName,
  recordCompletedMatch,
  resolvePlayerNames,
  savePlayerNames,
} from '../src/history/playerProgress.js';
import { HISTORY_STORAGE_KEY, clearMatchHistory } from '../src/history/matchHistory.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function createMatch({
  id = 'match-1',
  mode = 'solo',
  names = { p1: 'Morgan' },
  winner = 'p1',
  date = '2026-10-15T12:00:00.000Z',
  winnerShots = 5,
  winnerMisses = 2,
  loserShots = 5,
  survivingShips = 3,
  totalShots,
} = {}) {
  const players = ['p1', 'p2'].map((playerId) => ({
    id: playerId,
    ships: Array.from({ length: 5 }, (_, index) => ({
      id: `ship-${index}`,
      cells: [{ row: index, column: 0 }],
    })),
    shots: [],
  }));
  const winnerPlayer = players.find(({ id: playerId }) => playerId === winner);
  winnerPlayer.shots = Array.from({ length: 5 - survivingShips }, (_, index) => ({
    row: index,
    column: 0,
    result: 'hit',
  }));
  const shotLog = [];
  for (let index = 0; index < winnerShots; index += 1) {
    shotLog.push({
      shooterId: winner,
      targetId: winner === 'p1' ? 'p2' : 'p1',
      row: 0,
      column: index,
      result: index < winnerMisses ? 'miss' : 'hit',
    });
  }
  const loser = winner === 'p1' ? 'p2' : 'p1';
  for (let index = 0; index < loserShots; index += 1) {
    shotLog.push({
      shooterId: loser,
      targetId: winner,
      row: index,
      column: 9,
      result: 'miss',
    });
  }
  while (totalShots !== undefined && shotLog.length < totalShots) {
    shotLog.push({
      shooterId: loser,
      targetId: winner,
      row: 9,
      column: shotLog.length % 10,
      result: 'miss',
    });
  }
  return {
    id,
    mode,
    createdAt: date,
    playerNames: names,
    game: { winnerId: winner, players },
    shotLog,
  };
}

function profile(progress, normalizedName = 'morgan') {
  return progress.profiles.find((entry) => entry.normalizedName === normalizedName);
}

describe('player names and independent progress storage', () => {
  it('trims names, defaults blanks, and normalizes case-insensitively', () => {
    expect(normalizePlayerName('  MoRgAn  ')).toBe('morgan');
    expect(resolvePlayerNames('  Casey ', '  ')).toMatchObject({
      playerOne: 'Casey',
      playerTwo: 'Player 2',
    });
    expect(loadPlayerNames(createStorage()).playerOne).toBe(PLAYER_ONE_DEFAULT);
  });

  it('persists the two names separately from progress and history keys', () => {
    const storage = createStorage();
    savePlayerNames({ playerOne: '  mORgan ', playerTwo: 'Riley' }, storage);
    recordCompletedMatch(createMatch(), storage);

    expect(loadPlayerNames(storage)).toEqual({ playerOne: 'mORgan', playerTwo: 'Riley' });
    expect(loadPlayerProgress(storage).profiles).toHaveLength(1);
    expect(storage.getItem(PLAYER_NAMES_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(PLAYER_PROGRESS_STORAGE_KEY)).not.toBeNull();
  });

  it('clearing match history leaves saved names and player progress intact', () => {
    const storage = createStorage();
    savePlayerNames({ playerOne: 'Morgan', playerTwo: 'Riley' }, storage);
    recordCompletedMatch(createMatch(), storage);
    storage.setItem(HISTORY_STORAGE_KEY, '[]');
    clearMatchHistory(storage);

    expect(loadPlayerNames(storage)).toEqual({ playerOne: 'Morgan', playerTwo: 'Riley' });
    expect(profile(loadPlayerProgress(storage))).toMatchObject({ lifetimeWins: 1 });
    expect(storage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('rejects malformed saved names and progress instead of resetting valid storage', () => {
    const storage = createStorage();
    storage.setItem(PLAYER_NAMES_STORAGE_KEY, '{bad');
    expect(() => loadPlayerNames(storage)).toThrow(PlayerProgressError);
    storage.setItem(PLAYER_PROGRESS_STORAGE_KEY, JSON.stringify({ version: 1, profiles: [] }));
    expect(() => loadPlayerProgress(storage)).toThrow(PlayerProgressError);
  });

  it('surfaces unavailable and write-failing browser storage', () => {
    const unreadable = { getItem() { throw new Error('blocked'); } };
    expect(() => loadPlayerNames(unreadable)).toThrow(PlayerProgressError);
    expect(() => loadPlayerProgress(unreadable)).toThrow(PlayerProgressError);
    const unwritable = {
      getItem: () => null,
      setItem() { throw new Error('blocked'); },
    };
    expect(() => savePlayerNames({ playerOne: 'Morgan', playerTwo: 'Riley' }, unwritable))
      .toThrow(PlayerProgressError);
    expect(() => recordCompletedMatch(createMatch(), unwritable)).toThrow(PlayerProgressError);
  });
});

describe('completed match progress', () => {
  it.each([
    [40, true, false],
    [41, false, false],
    [139, false, false],
    [140, false, true],
  ])('awards battle-length achievements at exactly %i total shots', (shots, short, long) => {
    const storage = createStorage();
    const match = createMatch({
      mode: 'local',
      names: { p1: 'Morgan', p2: 'Opponent' },
      totalShots: shots,
      winnerShots: 1,
      winnerMisses: 0,
      loserShots: 0,
    });
    const result = recordCompletedMatch(match, storage);
    expect(profile(result).achievements.includes('short-battle')).toBe(short);
    expect(profile(result).achievements.includes('long-battle')).toBe(long);
    expect(profile(result, 'opponent').achievements.includes('short-battle')).toBe(short);
    expect(profile(result, 'opponent').achievements.includes('long-battle')).toBe(long);
  });

  it('keeps one personal best per normalized profile and mode, with earliest exact ties', () => {
    const storage = createStorage();
    recordCompletedMatch(createMatch({
      id: 'first', winnerShots: 5, winnerMisses: 2, date: '2026-10-15T10:00:00.000Z',
    }), storage);
    recordCompletedMatch(createMatch({
      id: 'tie', names: { p1: 'MORGAN', p2: 'Other' }, winnerShots: 5, winnerMisses: 2,
      date: '2026-10-15T11:00:00.000Z',
    }), storage);
    recordCompletedMatch(createMatch({
      id: 'fewer-shots', winnerShots: 4, winnerMisses: 2,
    }), storage);
    recordCompletedMatch(createMatch({
      id: 'fewer-misses', winnerShots: 9, winnerMisses: 1,
    }), storage);
    const result = loadPlayerProgress(storage);

    expect(profile(result)).toMatchObject({
      name: 'Morgan',
      lifetimeWins: 4,
      bestScores: { solo: { matchId: 'fewer-misses', misses: 1, shots: 9 } },
    });
  });

  it('ranks leaderboard entries by misses, shots, then earliest result', () => {
    const storage = createStorage();
    const results = [
      ['later-tie', 'Later', 2, 4, '2026-10-15T12:00:00.000Z'],
      ['early-tie', 'Early', 2, 4, '2026-10-15T10:00:00.000Z'],
      ['few-shots', 'Few Shots', 2, 3, '2026-10-15T14:00:00.000Z'],
      ['few-misses', 'Few Misses', 1, 9, '2026-10-15T16:00:00.000Z'],
    ];
    for (const [id, name, misses, shots, date] of results) {
      recordCompletedMatch(createMatch({
        id,
        names: { p1: name },
        winnerShots: shots,
        winnerMisses: misses,
        date,
      }), storage);
    }

    expect(getPlayerLeaderboard(loadPlayerProgress(storage), 'solo').map(({ name }) => name))
      .toEqual(['Few Misses', 'Few Shots', 'Early', 'Later']);
    expect(getPlayerLeaderboard(loadPlayerProgress(storage), 'local')).toEqual([]);
  });

  it('keeps the earliest timestamp when equally ranked results arrive out of order', () => {
    const storage = createStorage();
    recordCompletedMatch(createMatch({
      id: 'later-result', winnerShots: 5, winnerMisses: 2, date: '2026-10-15T12:00:00.000Z',
    }), storage);
    recordCompletedMatch(createMatch({
      id: 'earlier-result', winnerShots: 5, winnerMisses: 2, date: '2026-10-15T10:00:00.000Z',
    }), storage);

    expect(profile(loadPlayerProgress(storage)).bestScores.solo.matchId).toBe('earlier-result');
  });

  it('counts wins and streaks across modes, resets only on a completed loss, and is idempotent', () => {
    const storage = createStorage();
    recordCompletedMatch(createMatch({ id: 'one' }), storage);
    recordCompletedMatch(createMatch({ id: 'two', mode: 'local' }), storage);
    let result = recordCompletedMatch(createMatch({ id: 'three', mode: 'local' }), storage);
    expect(profile(result).currentStreak).toBe(3);
    expect(profile(result).achievements).toContain('streak-3');

    result = recordCompletedMatch(createMatch({
      id: 'loss', mode: 'local', winner: 'p2', names: { p1: 'Morgan', p2: 'Opponent' },
    }), storage);
    expect(profile(result).currentStreak).toBe(0);
    result = recordCompletedMatch(createMatch({ id: 'loss', winner: 'p1' }), storage);
    expect(profile(result).lifetimeWins).toBe(3);
    expect(profile(result).currentStreak).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('unlocks only the exact %i-ship victory achievement', (ships) => {
    const result = recordCompletedMatch(createMatch({ survivingShips: ships }), createStorage());
    expect(profile(result).achievements).toContain(`ships-${ships}`);
    expect([1, 2, 3, 4, 5].filter((count) => profile(result).achievements.includes(`ships-${count}`)))
      .toEqual([ships]);
  });

  it('awards flawless aim only when the winner has no misses', () => {
    const storage = createStorage();
    let result = recordCompletedMatch(createMatch({ winnerMisses: 0 }), storage);
    expect(profile(result).achievements).toContain('flawless-aim');
    result = recordCompletedMatch(createMatch({
      id: 'not-flawless', names: { p1: 'Riley', p2: 'Opponent' }, winnerMisses: 1,
    }), storage);
    expect(profile(result, 'riley').achievements).not.toContain('flawless-aim');
  });

  it('unlocks every streak and lifetime-win milestone at its boundary', () => {
    const storage = createStorage();
    for (let index = 0; index < 100; index += 1) {
      recordCompletedMatch(createMatch({ id: `win-${index}` }), storage);
    }
    expect(profile(loadPlayerProgress(storage)).achievements).toEqual(expect.arrayContaining([
      'streak-3', 'streak-5', 'streak-10', 'streak-20', 'streak-50',
      'wins-10', 'wins-50', 'wins-100',
    ]));
  });
});
