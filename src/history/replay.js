export function getReplayCursor(cursor, shotCount, offset) {
  if (!Number.isInteger(cursor) || !Number.isInteger(shotCount) || shotCount < 0) {
    throw new RangeError('Replay cursor and shot count must be nonnegative integers.');
  }
  return Math.min(shotCount, Math.max(0, cursor + offset));
}

export function getReplayPlayer(match, playerId, cursor) {
  const player = match.game.players.find(({ id }) => id === playerId);
  if (!player) throw new Error(`Unknown replay player: ${playerId}`);
  return {
    ...player,
    shots: match.shotLog
      .slice(0, cursor)
      .filter(({ targetId }) => targetId === playerId)
      .map(({ row, column, result, shipId, shipName }) => (
        { row, column, result, shipId, shipName }
      )),
  };
}
