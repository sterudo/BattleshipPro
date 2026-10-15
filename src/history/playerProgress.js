export const PLAYER_NAMES_STORAGE_KEY = 'fleet-command.player-names.v1';
export const PLAYER_PROGRESS_STORAGE_KEY = 'fleet-command.player-progress.v1';
export const PLAYER_ONE_DEFAULT = 'Player 1';
export const PLAYER_TWO_DEFAULT = 'Player 2';

const MODES = ['solo', 'local'];
const ACHIEVEMENT_IDS = new Set([
  'short-battle',
  'long-battle',
  'first-victory',
  'wins-10',
  'wins-50',
  'wins-100',
  'streak-3',
  'streak-5',
  'streak-10',
  'streak-20',
  'streak-50',
  'ships-1',
  'ships-2',
  'ships-3',
  'ships-4',
  'ships-5',
  'flawless-aim',
]);

export class PlayerProgressError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'PlayerProgressError';
  }
}

export function normalizePlayerName(value) {
  return value.trim().toLowerCase();
}

export function resolvePlayerNames(playerOne, playerTwo = '') {
  const first = playerOne.trim() || PLAYER_ONE_DEFAULT;
  const second = playerTwo.trim() || PLAYER_TWO_DEFAULT;
  return {
    playerOne: first,
    playerTwo: second,
    normalizedPlayerOne: normalizePlayerName(first),
    normalizedPlayerTwo: normalizePlayerName(second),
  };
}

function getStorage(storage) {
  try {
    const availableStorage = storage ?? globalThis.localStorage;
    if (!availableStorage) throw new Error('Browser storage is unavailable.');
    return availableStorage;
  } catch (error) {
    throw new PlayerProgressError('Could not access browser storage.', error);
  }
}

function readJson(key, storage, description) {
  const store = getStorage(storage);
  let raw;
  try {
    raw = store.getItem(key);
  } catch (error) {
    throw new PlayerProgressError(`Could not read ${description} from browser storage.`, error);
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new PlayerProgressError(`Saved ${description} is not valid JSON.`, error);
  }
}

function writeJson(key, value, storage, description) {
  const store = getStorage(storage);
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new PlayerProgressError(`Could not save ${description} to browser storage.`, error);
  }
}

export function loadPlayerNames(storage) {
  const saved = readJson(PLAYER_NAMES_STORAGE_KEY, storage, 'player names');
  if (saved === null) return { playerOne: PLAYER_ONE_DEFAULT, playerTwo: PLAYER_TWO_DEFAULT };
  if (typeof saved.playerOne !== 'string' || typeof saved.playerTwo !== 'string'
    || !saved.playerOne.trim() || !saved.playerTwo.trim()) {
    throw new PlayerProgressError('Saved player names contain invalid data.');
  }
  return { playerOne: saved.playerOne, playerTwo: saved.playerTwo };
}

export function savePlayerNames(names, storage) {
  const resolved = resolvePlayerNames(names.playerOne, names.playerTwo);
  writeJson(PLAYER_NAMES_STORAGE_KEY, {
    playerOne: resolved.playerOne,
    playerTwo: resolved.playerTwo,
  }, storage, 'player names');
  return { playerOne: resolved.playerOne, playerTwo: resolved.playerTwo };
}

function emptyProfile(normalizedName, name) {
  return {
    normalizedName,
    name,
    lifetimeWins: 0,
    currentStreak: 0,
    achievements: [],
    bestScores: { solo: null, local: null },
  };
}

function validScore(score) {
  return score === null || (
    typeof score === 'object'
    && Number.isInteger(score.misses) && score.misses >= 0
    && Number.isInteger(score.shots) && score.shots >= 0
    && typeof score.createdAt === 'string' && !Number.isNaN(Date.parse(score.createdAt))
    && typeof score.matchId === 'string' && score.matchId.length > 0
  );
}

function validProgress(value) {
  if (value === null) return { version: 1, processedMatchIds: [], profiles: [] };
  return value?.version === 1
    && Array.isArray(value.processedMatchIds)
    && value.processedMatchIds.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(value.processedMatchIds).size === value.processedMatchIds.length
    && Array.isArray(value.profiles)
    && value.profiles.every((profile) => (
      typeof profile?.normalizedName === 'string'
      && profile.normalizedName.length > 0
      && typeof profile.name === 'string'
      && profile.name.trim().length > 0
      && profile.normalizedName === normalizePlayerName(profile.name)
      && Number.isInteger(profile.lifetimeWins) && profile.lifetimeWins >= 0
      && Number.isInteger(profile.currentStreak) && profile.currentStreak >= 0
      && Array.isArray(profile.achievements)
      && profile.achievements.every((id) => ACHIEVEMENT_IDS.has(id))
      && new Set(profile.achievements).size === profile.achievements.length
      && profile.bestScores != null
      && MODES.every((mode) => validScore(profile.bestScores[mode]))
    ))
    && new Set(value.profiles.map(({ normalizedName }) => normalizedName)).size === value.profiles.length;
}

export function loadPlayerProgress(storage) {
  const value = readJson(PLAYER_PROGRESS_STORAGE_KEY, storage, 'player progress');
  if (!validProgress(value)) {
    throw new PlayerProgressError('Saved player progress contains invalid data.');
  }
  return value ?? { version: 1, processedMatchIds: [], profiles: [] };
}

export function getPlayerLeaderboard(progress, mode) {
  if (!MODES.includes(mode)) throw new PlayerProgressError('Unknown leaderboard mode.');
  return progress.profiles
    .filter((profile) => profile.bestScores[mode])
    .map((profile) => ({
      name: profile.name,
      normalizedName: profile.normalizedName,
      ...profile.bestScores[mode],
    }))
    .sort((left, right) => left.misses - right.misses
      || left.shots - right.shots
      || Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function getProfile(progress, name) {
  const normalizedName = normalizePlayerName(name);
  let profile = progress.profiles.find((entry) => entry.normalizedName === normalizedName);
  if (!profile) {
    profile = emptyProfile(normalizedName, name);
    progress.profiles.push(profile);
  }
  profile.name = name;
  return profile;
}

function unlock(profile, ...ids) {
  for (const id of ids) {
    if (id && !profile.achievements.includes(id)) profile.achievements.push(id);
  }
}

function scoreIsBetter(next, previous) {
  if (!previous) return true;
  if (next.misses !== previous.misses) return next.misses < previous.misses;
  if (next.shots !== previous.shots) return next.shots < previous.shots;
  return Date.parse(next.createdAt) < Date.parse(previous.createdAt);
}

export function recordCompletedMatch(match, storage) {
  const progress = loadPlayerProgress(storage);
  if (progress.processedMatchIds.includes(match.id)) return progress;
  const mode = match.mode ?? 'solo';
  if (!MODES.includes(mode) || !match.playerNames || !Array.isArray(match.game?.players)) {
    throw new PlayerProgressError('Completed match is missing valid player progress metadata.');
  }
  const totalShots = match.shotLog.length;
  for (const player of match.game.players) {
    const name = match.playerNames[player.id];
    if (typeof name !== 'string' || !name.trim()) continue;
    const profile = getProfile(progress, name.trim());
    if (totalShots <= 40) unlock(profile, 'short-battle');
    if (totalShots >= 140) unlock(profile, 'long-battle');
    if (player.id !== match.game.winnerId) {
      profile.currentStreak = 0;
      continue;
    }
    profile.lifetimeWins += 1;
    profile.currentStreak += 1;
    unlock(profile, 'first-victory');
    if (profile.lifetimeWins >= 10) unlock(profile, 'wins-10');
    if (profile.lifetimeWins >= 50) unlock(profile, 'wins-50');
    if (profile.lifetimeWins >= 100) unlock(profile, 'wins-100');
    for (const threshold of [3, 5, 10, 20, 50]) {
      if (profile.currentStreak >= threshold) unlock(profile, `streak-${threshold}`);
    }
    const ownShots = match.shotLog.filter(({ shooterId }) => shooterId === player.id);
    const ownMisses = ownShots.filter(({ result }) => result === 'miss').length;
    const ownShipsRemaining = player.ships.filter(({ cells }) => !cells.every((cell) => (
      player.shots.some((shot) => shot.row === cell.row && shot.column === cell.column)
    ))).length;
    if (ownShipsRemaining >= 1 && ownShipsRemaining <= 5) {
      unlock(profile, `ships-${ownShipsRemaining}`);
    }
    if (ownMisses === 0) unlock(profile, 'flawless-aim');
    const candidate = {
      misses: ownMisses,
      shots: ownShots.length,
      createdAt: match.createdAt,
      matchId: match.id,
    };
    if (scoreIsBetter(candidate, profile.bestScores[mode])) {
      profile.bestScores[mode] = candidate;
    }
  }
  progress.processedMatchIds.push(match.id);
  writeJson(PLAYER_PROGRESS_STORAGE_KEY, progress, storage, 'player progress');
  return progress;
}
