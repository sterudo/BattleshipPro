<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import GameBoard from './components/GameBoard.vue';
import { chooseAiShot } from './engine/ai.js';
import { createAiTurnRunner } from './engine/aiTurnRunner.js';
import {
  FLEET,
  RuleError,
  clearFleet,
  createGame,
  fireShot,
  moveShip,
  placeShip,
  randomizeFleet,
  rotateShip,
  startGame,
} from './engine/gameLogic.js';
import {
  clearMatchHistory,
  loadMatchHistory,
  saveMatch,
} from './history/matchHistory.js';
import {
  PLAYER_ONE_DEFAULT,
  PLAYER_TWO_DEFAULT,
  getPlayerLeaderboard,
  loadPlayerNames,
  loadPlayerProgress,
  normalizePlayerName,
  recordCompletedMatch,
  resolvePlayerNames,
  savePlayerNames,
} from './history/playerProgress.js';
import { getReplayCursor, getReplayPlayer } from './history/replay.js';

const HUMAN = 'captain';
const COMPUTER = 'computer';
const LOCAL_ONE = 'player-1';
const LOCAL_TWO = 'player-2';
const ACHIEVEMENT_LABELS = {
  'short-battle': 'Short Battle',
  'long-battle': 'Long Battle',
  'first-victory': 'First Victory',
  'wins-10': '10 Lifetime Wins',
  'wins-50': '50 Lifetime Wins',
  'wins-100': '100 Lifetime Wins',
  'streak-3': '3-Win Streak',
  'streak-5': '5-Win Streak',
  'streak-10': '10-Win Streak',
  'streak-20': '20-Win Streak',
  'streak-50': '50-Win Streak',
  'ships-1': 'One Ship Survived',
  'ships-2': 'Two Ships Survived',
  'ships-3': 'Three Ships Survived',
  'ships-4': 'Four Ships Survived',
  'ships-5': 'Five Ships Survived',
  'flawless-aim': 'Flawless Aim',
};
const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', detail: 'Random open waters' },
  { id: 'medium', name: 'Medium', detail: 'Hunts around hits' },
  { id: 'hard', name: 'Hard', detail: 'Probability targeting' },
];

const game = ref(createGame([HUMAN, COMPUTER]));
const mode = ref('solo');
const localSetupStage = ref('player1');
const battleStarted = ref(false);
const playerOneName = ref(PLAYER_ONE_DEFAULT);
const playerTwoName = ref(PLAYER_TWO_DEFAULT);
const difficulty = ref('medium');
const orientation = ref('horizontal');
const selectedShipId = ref(FLEET[0].id);
const draggedShip = ref('');
const dragPoint = ref(null);
const placementPreview = ref(null);
const notice = ref('Select a ship, then place it anywhere on the grid.');
const error = ref('');
const shotLog = ref([]);
const history = ref([]);
const historyError = ref('');
const playerProgress = ref({ version: 1, processedMatchIds: [], profiles: [] });
const progressError = ref('');
const processingAi = ref(false);
const replayMatch = ref(null);
const replayCursor = ref(0);
const replayPlaying = ref(false);
const completedMatch = ref(null);
let replayTimer;
let pointerDrag;
let dragScrollFrame;
let suppressShipClick = false;
const aiTurns = createAiTurnRunner({
  canShoot: () => game.value.phase === 'playing' && game.value.currentPlayerId === COMPUTER,
  shoot: () => {
    const position = chooseAiShot(game.value, COMPUTER, difficulty.value);
    const shot = recordShot(COMPUTER, HUMAN, position);
    notice.value = describeShot(COMPUTER, shot);
    if (game.value.phase === 'finished') finishMatch();
  },
  onError: presentError,
  onProcessing: (processing) => { processingAi.value = processing; },
});

const human = computed(() => game.value.players.find(({ id }) => id === HUMAN));
const computer = computed(() => game.value.players.find(({ id }) => id === COMPUTER));
const playerOne = computed(() => game.value.players.find(({ id }) => (
  id === (mode.value === 'solo' ? HUMAN : LOCAL_ONE)
)));
const playerTwo = computed(() => game.value.players.find(({ id }) => (
  id === (mode.value === 'solo' ? COMPUTER : LOCAL_TWO)
)));
const setupPlayerId = computed(() => (
  mode.value === 'solo'
    ? HUMAN
    : localSetupStage.value === 'player2' ? LOCAL_TWO : LOCAL_ONE
));
const setupPlayer = computed(() => (
  mode.value === 'solo' ? human.value : game.value.players.find(({ id }) => id === setupPlayerId.value)
));
const selectedShip = computed(() => FLEET.find(({ id }) => id === (draggedShip.value || selectedShipId.value)));
const placedShipIds = computed(() => new Set((setupPlayer.value?.ships ?? []).map(({ id }) => id)));
const remainingShips = computed(() => FLEET.filter(({ id }) => !placedShipIds.value.has(id)));
const isSetup = computed(() => game.value.phase === 'setup');
const isFinished = computed(() => game.value.phase === 'finished');
const canEditFleet = computed(() => isSetup.value && (
  mode.value === 'solo' || ['player1', 'player2'].includes(localSetupStage.value)
));
const isLocalHandoff = computed(() => mode.value === 'local' && localSetupStage.value === 'handoff');
const isLocalReady = computed(() => mode.value === 'local' && localSetupStage.value === 'ready');
const currentShooter = computed(() => (
  game.value.players.find(({ id }) => id === game.value.currentPlayerId)
));
const namesValid = computed(() => mode.value !== 'local'
  || normalizePlayerName(playerOneName.value.trim() || PLAYER_ONE_DEFAULT)
    !== normalizePlayerName(playerTwoName.value.trim() || PLAYER_TWO_DEFAULT));
const profilesByName = computed(() => new Map(
  playerProgress.value.profiles.map((profile) => [profile.normalizedName, profile]),
));
const currentProfiles = computed(() => {
  const names = resolvePlayerNames(playerOneName.value, playerTwoName.value);
  return [names.playerOne, ...(mode.value === 'local' ? [names.playerTwo] : [])]
    .map((name) => profilesByName.value.get(normalizePlayerName(name)))
    .filter(Boolean);
});
const soloLeaderboard = computed(() => leaderboard('solo'));
const localLeaderboard = computed(() => leaderboard('local'));
const replayShots = computed(() => replayMatch.value?.shotLog ?? []);
const replayPosition = computed(() => (
  replayCursor.value === 0 ? 'Before first shot' : `Shot ${replayCursor.value} of ${replayShots.value.length}`
));
const replayCurrentShot = computed(() => replayShots.value[replayCursor.value - 1] ?? null);

onMounted(() => {
  try {
    history.value = loadMatchHistory();
  } catch (caught) {
    historyError.value = caught.message;
  }
  try {
    const names = loadPlayerNames();
    playerOneName.value = names.playerOne;
    playerTwoName.value = names.playerTwo;
  } catch (caught) {
    progressError.value = caught.message;
  }
  try {
    playerProgress.value = loadPlayerProgress();
  } catch (caught) {
    progressError.value = caught.message;
  }
});

onBeforeUnmount(() => {
  aiTurns.cancel();
  cancelShipDrag();
  stopReplay();
});

function presentError(caught) {
  error.value = caught instanceof RuleError
    ? caught.message
    : caught instanceof Error ? caught.message : 'The action could not be completed.';
  notice.value = '';
}

function selectShip(shipId) {
  if (!canEditFleet.value || placedShipIds.value.has(shipId)) return;
  selectedShipId.value = shipId;
  notice.value = `Place your ${FLEET.find(({ id }) => id === shipId).name}.`;
  error.value = '';
}

function clickShip(event, shipId) {
  const suppress = suppressShipClick && event.detail > 0;
  suppressShipClick = false;
  if (suppress) return;
  selectShip(shipId);
}

function startShipDrag(event, shipId, grabbedCell) {
  if (!event.isPrimary || event.button !== 0 || !canEditFleet.value) return;
  suppressShipClick = false;
  selectShip(shipId);
  const placed = setupPlayer.value.ships.find((ship) => ship.id === shipId);
  pointerDrag = {
    id: event.pointerId,
    shipId,
    startX: event.clientX,
    startY: event.clientY,
    source: event.currentTarget,
    moved: false,
    orientation: placed?.orientation ?? orientation.value,
    offset: grabbedCell && placed ? {
      row: grabbedCell.row - placed.cells[0].row,
      column: grabbedCell.column - placed.cells[0].column,
    } : { row: 0, column: 0 },
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function scrollWhileDragging() {
  if (!pointerDrag?.moved || !dragPoint.value) return;
  const { y } = dragPoint.value;
  if (y < 65) window.scrollBy(0, -10);
  else if (y > window.innerHeight - 65) window.scrollBy(0, 10);
  updatePlacementPreview(dragPoint.value.x, dragPoint.value.y);
  dragScrollFrame = window.requestAnimationFrame(scrollWhileDragging);
}

function moveShipDrag(event) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
  dragPoint.value = { x: event.clientX, y: event.clientY };
  if (!pointerDrag.moved && Math.hypot(
    event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY,
  ) >= 6) {
    pointerDrag.moved = true;
    draggedShip.value = pointerDrag.shipId;
    scrollWhileDragging();
  }
  if (pointerDrag.moved) updatePlacementPreview(event.clientX, event.clientY);
}

function updatePlacementPreview(x, y) {
  const cell = document.elementFromPoint(x, y)?.closest('[data-placement-cell]');
  if (!cell || !pointerDrag) {
    placementPreview.value = null;
    return;
  }
  const position = {
    row: Number(cell.dataset.row) - pointerDrag.offset.row,
    column: Number(cell.dataset.column) - pointerDrag.offset.column,
  };
  const ship = FLEET.find(({ id }) => id === pointerDrag.shipId);
  let valid = true;
  try {
    const operation = placedShipIds.value.has(ship.id) ? moveShip : placeShip;
    operation(game.value, setupPlayerId.value, ship.id, position, pointerDrag.orientation);
  } catch (caught) {
    if (!(caught instanceof RuleError)) throw caught;
    valid = false;
  }
  placementPreview.value = {
    position,
    valid,
    cells: Array.from({ length: ship.length }, (_, offset) => ({
      row: position.row + (pointerDrag.orientation === 'vertical' ? offset : 0),
      column: position.column + (pointerDrag.orientation === 'horizontal' ? offset : 0),
    })),
  };
}

function startBoardDrag(event, position) {
  const ship = setupPlayer.value.ships.find(({ cells }) => (
    cells.some((cell) => cell.row === position.row && cell.column === position.column)
  ));
  if (ship) startShipDrag(event, ship.id, position);
}

function rotateBoardShip(position) {
  if (!canEditFleet.value) return;
  const ship = setupPlayer.value.ships.find(({ cells }) => (
    cells.some((cell) => cell.row === position.row && cell.column === position.column)
  ));
  if (!ship) return;
  cancelShipDrag();
  try {
    game.value = rotateShip(game.value, setupPlayerId.value, ship.id);
    error.value = '';
    notice.value = `${ship.name} rotated to the nearest available position.`;
  } catch (caught) {
    presentError(caught);
  }
}

function cancelShipDrag() {
  const drag = pointerDrag;
  pointerDrag = undefined;
  if (drag?.source.hasPointerCapture(drag.id)) {
    drag.source.releasePointerCapture(drag.id);
  }
  window.cancelAnimationFrame(dragScrollFrame);
  draggedShip.value = '';
  dragPoint.value = null;
  placementPreview.value = null;
}

function endShipDrag(event) {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
  const { shipId, moved, orientation: shipOrientation } = pointerDrag;
  updatePlacementPreview(event.clientX, event.clientY);
  const preview = placementPreview.value;
  cancelShipDrag();
  if (!moved) return;
  suppressShipClick = true;
  if (preview) {
    placeSelected(preview.position, shipId, shipOrientation);
  } else {
    notice.value = 'Drag cancelled. Drop on your waters, or tap a starting cell to place the selected ship.';
  }
}

function placeSelected(position, shipId = selectedShipId.value, shipOrientation = orientation.value) {
  if (!canEditFleet.value || !shipId) return;
  try {
    const operation = placedShipIds.value.has(shipId) ? moveShip : placeShip;
    game.value = operation(game.value, setupPlayerId.value, shipId, position, shipOrientation);
    const nextShip = FLEET.find(({ id }) => !setupPlayer.value.ships.some((ship) => ship.id === id));
    selectedShipId.value = nextShip?.id ?? '';
    notice.value = nextShip
      ? `${FLEET.find(({ id }) => id === shipId).name} placed. Now place your ${nextShip.name}.`
      : 'Fleet ready.';
    error.value = '';
    advanceLocalSetup();
  } catch (caught) {
    presentError(caught);
  }
}

function onCell(position, boardPlayerId) {
  if (suppressShipClick) {
    suppressShipClick = false;
    return;
  }
  if (canEditFleet.value) {
    if (setupPlayer.value.ships.some(({ cells }) => cells.some((cell) => (
      cell.row === position.row && cell.column === position.column
    )))) return;
    placeSelected(position, draggedShip.value || selectedShipId.value);
    draggedShip.value = '';
    return;
  }
  if (mode.value === 'solo' && game.value.phase === 'playing'
    && game.value.currentPlayerId === HUMAN && boardPlayerId === COMPUTER && !processingAi.value) {
    fireAt(position, HUMAN, COMPUTER);
  } else if (mode.value === 'local' && battleStarted.value
    && game.value.phase === 'playing' && boardPlayerId !== game.value.currentPlayerId) {
    fireAt(position, game.value.currentPlayerId, boardPlayerId);
  }
}

function randomizePlayerFleet() {
  try {
    if (!canEditFleet.value) return;
    game.value = randomizeFleet(game.value, setupPlayerId.value);
    selectedShipId.value = '';
    notice.value = 'Fleet randomized. Review the layout or start the engagement.';
    error.value = '';
    advanceLocalSetup();
  } catch (caught) {
    presentError(caught);
  }
}

function clearPlayerFleet() {
  try {
    if (!canEditFleet.value) return;
    game.value = clearFleet(game.value, setupPlayerId.value);
    selectedShipId.value = FLEET[0].id;
    notice.value = 'Fleet cleared. Select a ship and place it on the grid.';
    error.value = '';
  } catch (caught) {
    presentError(caught);
  }
}

function advanceLocalSetup() {
  if (mode.value !== 'local' || !canEditFleet.value || setupPlayer.value.ships.length !== FLEET.length) return;
  if (!namesValid.value) {
    presentError(new Error('Local players must use different names.'));
    return;
  }
  if (localSetupStage.value === 'player1') {
    localSetupStage.value = 'handoff';
    notice.value = `Pass the device to ${resolvePlayerNames(playerOneName.value, playerTwoName.value).playerTwo}.`;
    selectedShipId.value = '';
    return;
  }
  try {
    const names = resolvePlayerNames(playerOneName.value, playerTwoName.value);
    savePlayerNames(names);
    playerOneName.value = names.playerOne;
    playerTwoName.value = names.playerTwo;
    game.value = startGame(game.value);
    localSetupStage.value = 'ready';
    battleStarted.value = false;
    notice.value = `${nameForPlayer(game.value.firstPlayerId)} fires first. Start battle when both players are ready.`;
    error.value = '';
  } catch (caught) {
    presentError(caught);
  }
}

function acknowledgeHandoff() {
  localSetupStage.value = 'player2';
  selectedShipId.value = FLEET[0].id;
  notice.value = `${playerTwoName.value || PLAYER_TWO_DEFAULT}, place your fleet.`;
  error.value = '';
}

function startLocalBattle() {
  battleStarted.value = true;
  notice.value = `${nameForPlayer(game.value.currentPlayerId)}'s turn. Select a cell on the opposing board.`;
}

function saveCurrentNames() {
  if (!namesValid.value) throw new Error('Local players must use different names.');
  const names = resolvePlayerNames(playerOneName.value, playerTwoName.value);
  savePlayerNames(names);
  playerOneName.value = names.playerOne;
  playerTwoName.value = names.playerTwo;
  return names;
}

function beginGame() {
  try {
    if (mode.value !== 'solo') return;
    if (remainingShips.value.length > 0) {
      throw new RuleError('INCOMPLETE_FLEET', 'Place every ship or randomize your fleet first.');
    }
    saveCurrentNames();
    let prepared = randomizeFleet(game.value, COMPUTER);
    game.value = startGame(prepared);
    shotLog.value = [];
    selectedShipId.value = '';
    notice.value = `${nameForPlayer(game.value.firstPlayerId)} fires first.`;
    error.value = '';
    if (game.value.currentPlayerId === COMPUTER) aiTurns.start();
  } catch (caught) {
    presentError(caught);
  }
}

function createMatchRecord() {
  const names = resolvePlayerNames(playerOneName.value, playerTwoName.value);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    mode: mode.value,
    difficulty: mode.value === 'solo' ? difficulty.value : null,
    game: game.value,
    shotLog: shotLog.value,
    playerNames: mode.value === 'solo'
      ? { [HUMAN]: names.playerOne }
      : { [LOCAL_ONE]: names.playerOne, [LOCAL_TWO]: names.playerTwo },
  };
}

function finishMatch() {
  const winnerName = nameForPlayer(game.value.winnerId);
  notice.value = `${winnerName} wins. The opposing fleet is sunk.`;
  completedMatch.value = createMatchRecord();
  try {
    history.value = saveMatch(completedMatch.value);
    historyError.value = '';
  } catch (caught) {
    historyError.value = caught.message;
  }
  try {
    playerProgress.value = recordCompletedMatch(completedMatch.value);
    progressError.value = '';
  } catch (caught) {
    progressError.value = caught.message;
  }
}

function recordShot(shooterId, targetId, position) {
  const result = fireShot(game.value, shooterId, targetId, position);
  game.value = result.game;
  shotLog.value = [...shotLog.value, {
    shooterId,
    targetId,
    row: position.row,
    column: position.column,
    result: result.shot.result,
    shipId: result.shot.shipId,
    shipName: result.shot.shipName,
  }];
  return result.shot;
}

function nameForPlayer(playerId, match = null) {
  const names = match?.playerNames;
  if (names?.[playerId]) return names[playerId];
  const matchMode = match ? (match.mode ?? 'solo') : mode.value;
  if (matchMode === 'local') {
    return playerId === LOCAL_ONE
      ? (playerOneName.value || PLAYER_ONE_DEFAULT)
      : (playerTwoName.value || PLAYER_TWO_DEFAULT);
  }
  if (match && !match.playerNames) return playerId === HUMAN ? 'You' : 'Computer';
  return playerId === HUMAN ? (playerOneName.value || PLAYER_ONE_DEFAULT) : 'Computer';
}

function describeShot(shooterId, shot) {
  const shooterName = `${nameForPlayer(shooterId)}'s shot`;
  if (shot.result === 'miss') return `${shooterName}: miss at ${String.fromCharCode(65 + shot.column)}${shot.row + 1}.`;
  if (shot.result === 'sunk') return `${shooterName}: ${shot.shipName} sunk!`;
  return `${shooterName}: direct hit.`;
}

function fireAt(position, shooterId = HUMAN, targetId = COMPUTER) {
  try {
    const shot = recordShot(shooterId, targetId, position);
    notice.value = describeShot(shooterId, shot);
    error.value = '';
    if (game.value.phase === 'finished') finishMatch();
    else if (mode.value === 'solo' && game.value.currentPlayerId === COMPUTER) aiTurns.start();
  } catch (caught) {
    presentError(caught);
  }
}

function restart() {
  aiTurns.cancel();
  cancelShipDrag();
  stopReplay();
  replayMatch.value = null;
  game.value = mode.value === 'local'
    ? createGame([LOCAL_ONE, LOCAL_TWO])
    : createGame([HUMAN, COMPUTER]);
  localSetupStage.value = 'player1';
  battleStarted.value = false;
  shotLog.value = [];
  completedMatch.value = null;
  selectedShipId.value = FLEET[0].id;
  orientation.value = 'horizontal';
  notice.value = mode.value === 'local'
    ? `New local match. ${playerOneName.value || PLAYER_ONE_DEFAULT} places first.`
    : 'New engagement. Place your fleet or randomize it.';
  error.value = '';
}

function clearHistory() {
  try {
    clearMatchHistory();
    history.value = [];
    historyError.value = '';
  } catch (caught) {
    historyError.value = caught.message;
  }
}

function changeMode(nextMode, event) {
  if (!['solo', 'local'].includes(nextMode) || mode.value === nextMode) return;
  const hasMatch = game.value.phase !== 'setup'
    || game.value.players.some(({ ships }) => ships.length > 0);
  if (hasMatch && !window.confirm('Changing mode will discard the current match. Continue?')) {
    if (event?.target) {
      event.target.checked = false;
      const currentModeRadio = document.querySelector(
        `input[name="game-mode"][value="${mode.value}"]`,
      );
      if (currentModeRadio) currentModeRadio.checked = true;
    }
    return;
  }
  aiTurns.cancel();
  cancelShipDrag();
  stopReplay();
  replayMatch.value = null;
  completedMatch.value = null;
  mode.value = nextMode;
  localSetupStage.value = 'player1';
  battleStarted.value = false;
  game.value = nextMode === 'local'
    ? createGame([LOCAL_ONE, LOCAL_TWO])
    : createGame([HUMAN, COMPUTER]);
  shotLog.value = [];
  selectedShipId.value = FLEET[0].id;
  notice.value = nextMode === 'local'
    ? `${playerOneName.value || PLAYER_ONE_DEFAULT} places first.`
    : 'Place your fleet or randomize it.';
  error.value = '';
}

function stopReplay() {
  replayPlaying.value = false;
  if (replayTimer) {
    window.clearInterval(replayTimer);
    replayTimer = undefined;
  }
}

function openReplay(match) {
  if (!match) return;
  stopReplay();
  replayMatch.value = match;
  replayCursor.value = 0;
  error.value = '';
}

function stepReplay(offset) {
  replayCursor.value = getReplayCursor(
    replayCursor.value, replayShots.value.length, offset,
  );
  if (replayCursor.value === replayShots.value.length) stopReplay();
}

function toggleReplay() {
  if (replayPlaying.value) {
    stopReplay();
    return;
  }
  if (replayCursor.value >= replayShots.value.length) replayCursor.value = 0;
  replayPlaying.value = true;
  replayTimer = window.setInterval(() => stepReplay(1), 700);
}

function replayBoard(matchPlayerId) {
  if (!replayMatch.value) return null;
  return getReplayPlayer(replayMatch.value, matchPlayerId, replayCursor.value);
}

function replayWinner(match) {
  const winner = nameForPlayer(match.game.winnerId, match);
  return `${winner} won`;
}

function leaderboard(scoreMode) {
  return getPlayerLeaderboard(playerProgress.value, scoreMode);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    .format(new Date(value));
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" @click.prevent="restart">
        <span class="brand-mark" aria-hidden="true">⌁</span>
        <span>FLEET<span class="brand-light">COMMAND</span></span>
      </a>
      <span class="topbar-caption">CLASSIC NAVAL ENGAGEMENT</span>
      <span class="online-status"><i /> LOCAL GAME</span>
    </header>

    <div class="page-layout">
      <section class="game-content">
        <div class="hero">
          <div class="eyebrow"><span /> OPERATION BLUEWATER</div>
          <h1>{{ replayMatch ? 'Match replay' : isSetup ? 'Prepare your fleet' : isFinished ? 'Engagement complete' : 'The open sea' }}</h1>
          <p class="hero-copy">
            {{ replayMatch ? 'Review every move from first contact to the final salvo.' : isSetup ? 'Position your vessels, then outmaneuver the opposing fleet.' : 'Track the opposing fleet and make every shot count.' }}
          </p>
        </div>

        <section v-if="!replayMatch" class="setup-panel" aria-labelledby="setup-title">
          <div class="section-title">
            <div><span class="step-tag">GAME MODE</span><h2 id="setup-title">Configure engagement</h2></div>
            <span class="fleet-progress">{{ mode === 'local' ? 'PASS & PLAY' : 'SOLO' }}</span>
          </div>
          <fieldset class="mode-select">
            <legend>Choose game mode</legend>
            <label :class="{ active: mode === 'solo' }">
              <input type="radio" name="game-mode" value="solo" :checked="mode === 'solo'" @change="changeMode('solo', $event)">
              <span><strong>Solo</strong><small>Play against the computer</small></span>
            </label>
            <label :class="{ active: mode === 'local' }">
              <input type="radio" name="game-mode" value="local" :checked="mode === 'local'" @change="changeMode('local', $event)">
              <span><strong>Local two-player</strong><small>Pass-and-play on this device</small></span>
            </label>
          </fieldset>
          <div class="player-name-fields">
            <label>Player 1 name
              <input v-model="playerOneName" type="text" autocomplete="off" :disabled="game.phase !== 'setup'">
            </label>
            <label v-if="mode === 'local'">Player 2 name
              <input v-model="playerTwoName" type="text" autocomplete="off" :disabled="game.phase !== 'setup'">
            </label>
          </div>
          <p v-if="mode === 'local' && !namesValid" class="validation-note" role="alert">Local players must use different names.</p>
          <fieldset v-if="mode === 'solo' && isSetup" class="difficulty-select">
            <legend>Computer difficulty</legend>
            <label v-for="option in DIFFICULTIES" :key="option.id" class="difficulty-option" :class="{ active: difficulty === option.id }">
              <input v-model="difficulty" type="radio" name="difficulty" :value="option.id">
              <span class="difficulty-dot" />
              <span><strong>{{ option.name }}</strong><small>{{ option.detail }}</small></span>
            </label>
          </fieldset>

          <div v-if="canEditFleet" class="fleet-controls">
            <div class="fleet-heading">
              <div><span class="step-tag">FLEET SETUP</span><h2>{{ mode === 'local' ? `${setupPlayerId === LOCAL_ONE ? playerOneName : playerTwoName}'s vessels` : 'Your vessels' }}</h2></div>
              <button class="text-button" type="button" @click="orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal'">
                <span class="rotate-icon" aria-hidden="true">↻</span> {{ orientation === 'horizontal' ? 'Horizontal' : 'Vertical' }}
              </button>
            </div>
            <p class="hint">Click or drag to place. Drag ships on your board to move them; right-click a ship (or focus its cell and press R) to rotate it. Red previews cannot be placed.</p>
            <p class="fleet-progress setup-count">{{ setupPlayer.ships.length }} / 5 vessels placed</p>
            <div class="ship-list">
              <button
                v-for="ship in FLEET"
                :key="ship.id"
                class="ship-option"
                :class="{ selected: selectedShipId === ship.id, placed: placedShipIds.has(ship.id) }"
                type="button"
                :disabled="placedShipIds.has(ship.id)"
                :aria-pressed="selectedShipId === ship.id"
                @click="clickShip($event, ship.id)"
                @pointerdown="startShipDrag($event, ship.id)"
                @pointermove="moveShipDrag"
                @pointerup="endShipDrag"
                @pointercancel="cancelShipDrag"
                @lostpointercapture="cancelShipDrag"
              >
                <span class="ship-symbol" aria-hidden="true"><i v-for="segment in ship.length" :key="segment" /></span>
                <span class="ship-name">{{ ship.name }}<small>{{ ship.length }} cells</small></span>
                <span class="ship-check">{{ placedShipIds.has(ship.id) ? '✓' : '' }}</span>
              </button>
            </div>
            <div class="setup-actions">
              <button class="secondary-button" type="button" @click="randomizePlayerFleet">⤨ Randomize</button>
              <button class="quiet-button" type="button" @click="clearPlayerFleet">Clear fleet</button>
            </div>
            <button
              v-if="mode === 'local' && setupPlayer.ships.length === FLEET.length"
              class="secondary-button continuation-button"
              type="button"
              :disabled="!namesValid"
              @click="advanceLocalSetup"
            >{{ localSetupStage === 'player1' ? `Pass device to ${playerTwoName}` : 'Continue to first shooter' }}</button>
          </div>
        </section>

        <div v-if="error" class="alert error-alert" role="alert"><span aria-hidden="true">!</span>{{ error }}</div>
        <div v-else-if="notice && !replayMatch" class="alert notice-alert" role="status"><span class="notice-icon" aria-hidden="true">◈</span>{{ processingAi ? 'Computer is choosing a target…' : notice }}</div>
        <div v-if="historyError" class="alert error-alert history-alert" role="alert"><span aria-hidden="true">!</span>{{ historyError }}</div>
        <div v-if="progressError" class="alert error-alert history-alert" role="alert"><span aria-hidden="true">!</span>{{ progressError }}</div>

        <section v-if="isLocalHandoff && !replayMatch" class="ready-panel">
          <span class="step-tag">PRIVATE SETUP COMPLETE</span>
          <h2>Pass the device to {{ playerTwoName }}</h2>
          <p>{{ playerOneName }}'s fleet is hidden. {{ playerTwoName }}, continue when you are ready to place your fleet.</p>
          <button class="primary-button" type="button" :disabled="!namesValid" @click="acknowledgeHandoff">Ready for {{ playerTwoName }} <span aria-hidden="true">→</span></button>
        </section>

        <section v-if="isLocalReady && !replayMatch" class="ready-panel">
          <span class="step-tag">FLEETS COMPLETE</span>
          <h2>{{ nameForPlayer(game.firstPlayerId) }} fires first</h2>
          <p>Both fleets are hidden. Start battle when both players are ready.</p>
          <button class="primary-button" type="button" @click="startLocalBattle">Start battle <span aria-hidden="true">→</span></button>
        </section>

        <div v-if="mode === 'local' && game.phase === 'playing' && !replayMatch" class="turn-banner" role="status">
          <strong>{{ battleStarted ? `${nameForPlayer(game.currentPlayerId)} to fire` : `${nameForPlayer(game.firstPlayerId)} fires first` }}</strong>
          <span v-if="battleStarted">A hit keeps the turn; a miss passes it immediately.</span>
        </div>

        <div v-if="!replayMatch && mode === 'solo'" class="boards" :class="{ 'boards-setup': isSetup }">
          <GameBoard
            :player="human"
            :title="isSetup ? 'Your waters' : 'Your fleet'"
            :subtitle="isSetup ? 'Place your ships on the grid' : 'Incoming fire is shown here'"
            :show-ships="true"
            :setup-mode="canEditFleet"
            :disabled="!canEditFleet"
            :dragged-ship="draggedShip"
            :placement-preview="placementPreview"
            @cell="onCell($event, HUMAN)"
            @ship-pointerdown="startBoardDrag"
            @ship-pointermove="moveShipDrag"
            @ship-pointerup="endShipDrag"
            @ship-pointercancel="cancelShipDrag"
            @rotate="rotateBoardShip"
          />
          <GameBoard
            :player="computer"
            :title="isSetup ? 'Enemy waters' : 'Opposing fleet'"
            :subtitle="isSetup ? 'Fleet hidden until engagement ends' : isFinished ? 'Enemy fleet revealed' : currentShooter?.id === HUMAN ? 'Select a target cell to fire' : 'Awaiting computer salvo'"
            :show-ships="isFinished"
            :disabled="isSetup || isFinished || processingAi || currentShooter?.id !== HUMAN"
            @cell="onCell($event, COMPUTER)"
          />
        </div>

        <div v-else-if="!replayMatch && mode === 'local' && canEditFleet" class="boards boards-setup">
          <GameBoard
            :player="setupPlayer"
            :title="`${setupPlayerId === LOCAL_ONE ? playerOneName : playerTwoName}'s waters`"
            subtitle="Only this player's fleet is visible during setup"
            :show-ships="true"
            setup-mode
            :disabled="false"
            :dragged-ship="draggedShip"
            :placement-preview="placementPreview"
            @cell="onCell($event, setupPlayerId)"
            @ship-pointerdown="startBoardDrag"
            @ship-pointermove="moveShipDrag"
            @ship-pointerup="endShipDrag"
            @ship-pointercancel="cancelShipDrag"
            @rotate="rotateBoardShip"
          />
        </div>
        <div v-else-if="!replayMatch && mode === 'local' && !isSetup" class="boards" :class="{ 'boards-setup': isLocalReady }">
          <GameBoard
            :player="playerOne"
            :title="playerOneName"
            :subtitle="isFinished ? 'Fleet revealed after battle' : currentShooter?.id === LOCAL_TWO ? 'Select a target cell to fire' : 'Unhit ships are concealed'"
            :show-ships="isFinished"
            :disabled="!battleStarted || isFinished || currentShooter?.id === LOCAL_ONE"
            @cell="onCell($event, LOCAL_ONE)"
          />
          <GameBoard
            :player="playerTwo"
            :title="playerTwoName"
            :subtitle="isFinished ? 'Fleet revealed after battle' : currentShooter?.id === LOCAL_ONE ? 'Select a target cell to fire' : 'Unhit ships are concealed'"
            :show-ships="isFinished"
            :disabled="!battleStarted || isFinished || currentShooter?.id === LOCAL_TWO"
            @cell="onCell($event, LOCAL_TWO)"
          />
        </div>

        <section v-if="isSetup && mode === 'solo' && !replayMatch" class="launch-row">
          <div class="launch-note"><span class="launch-icon" aria-hidden="true">⌖</span><span>Ships can touch, but cannot overlap.<small>{{ remainingShips.length ? `${remainingShips.length} vessel${remainingShips.length === 1 ? '' : 's'} left to place` : 'All vessels are positioned and ready' }}</small></span></div>
          <button class="primary-button" type="button" :disabled="remainingShips.length > 0" @click="beginGame">Begin engagement <span aria-hidden="true">→</span></button>
        </section>

        <section v-if="isFinished && !replayMatch" class="result-panel">
          <div class="result-icon">✦</div>
          <div><span class="step-tag">MISSION REPORT</span><h2>{{ nameForPlayer(game.winnerId) }} wins</h2><p>{{ mode === 'local' ? 'Both fleets are revealed for review.' : game.winnerId === HUMAN ? 'You successfully located and sank the entire opposing fleet.' : 'The opposing fleet has sunk your final vessel.' }} The finished match has been recorded.</p></div>
          <div class="result-actions"><button class="primary-button" type="button" @click="restart">{{ mode === 'local' ? 'New local match' : 'New engagement' }} <span aria-hidden="true">→</span></button><button class="secondary-button" type="button" @click="openReplay(completedMatch)">Review match</button></div>
        </section>

        <section v-if="replayMatch" class="replay-panel">
          <div class="replay-header"><div><span class="step-tag">MATCH PLAYBACK</span><h2>{{ replayWinner(replayMatch) }} · {{ replayMatch.mode === 'local' ? 'Local two-player' : `${replayMatch.difficulty} AI` }}</h2></div><button class="quiet-button" type="button" @click="replayMatch = null; stopReplay()">Close replay</button></div>
          <div class="replay-controls">
            <button class="icon-button" type="button" aria-label="Previous shot" :disabled="replayCursor === 0" @click="stepReplay(-1)">‹</button>
            <button class="play-button" type="button" :aria-label="replayPlaying ? 'Pause replay' : 'Play replay'" @click="toggleReplay">{{ replayPlaying ? 'Ⅱ' : '▶' }}</button>
            <button class="icon-button" type="button" aria-label="Next shot" :disabled="replayCursor >= replayShots.length" @click="stepReplay(1)">›</button>
            <span>{{ replayPosition }}</span>
            <input v-model.number="replayCursor" type="range" min="0" :max="replayShots.length" aria-label="Replay shot position" @input="stopReplay">
          </div>
          <p v-if="replayCurrentShot" class="replay-caption">
            {{ nameForPlayer(replayCurrentShot.shooterId, replayMatch) }} fired at
            {{ String.fromCharCode(65 + replayCurrentShot.column) }}{{ replayCurrentShot.row + 1 }}:
            {{ replayCurrentShot.result === 'sunk' ? `${replayCurrentShot.shipName} sunk` : replayCurrentShot.result }}.
          </p>
          <div class="boards replay-boards">
            <GameBoard
              v-for="player in replayMatch.game.players"
              :key="player.id"
              :player="replayBoard(player.id)"
              :title="nameForPlayer(player.id, replayMatch)"
              subtitle="Final fleet layout"
              :show-ships="true"
              disabled
            />
          </div>
        </section>

        <section v-if="!replayMatch && (history.length || historyError)" class="history-panel">
          <div class="history-heading"><div><span class="step-tag">ARCHIVE</span><h2>Recent engagements</h2></div><button class="quiet-button" type="button" @click="clearHistory">Clear history</button></div>
          <p v-if="history.length === 0" class="history-empty">No saved match history is available.</p>
          <button v-for="match in history" :key="match.id" class="history-row" type="button" @click="openReplay(match)">
            <span class="history-outcome won">W</span>
            <span class="history-description"><strong>{{ replayWinner(match) }}</strong><small>{{ formatDate(match.createdAt) }} · {{ match.mode === 'local' ? `${match.playerNames[match.game.players[0].id]} vs ${match.playerNames[match.game.players[1].id]} · local` : `${match.difficulty} difficulty` }}</small></span>
            <span class="history-arrow">↗</span>
          </button>
        </section>

        <section v-if="!replayMatch" class="progress-panel">
          <div class="history-heading"><div><span class="step-tag">PLAYER RECORDS</span><h2>High scores & achievements</h2></div></div>
          <div class="leaderboard-grid">
            <section aria-label="Solo leaderboard">
              <h3>Solo · all AI difficulties</h3>
              <p v-if="soloLeaderboard.length === 0" class="history-empty">No qualifying wins yet.</p>
              <div v-for="(score, index) in soloLeaderboard.slice(0, 5)" :key="`solo-${score.normalizedName || score.name}-${index}`" class="score-row">
                <strong>{{ index + 1 }}. {{ score.name }}</strong><span>{{ score.misses }} misses · {{ score.shots }} shots</span>
              </div>
            </section>
            <section aria-label="Local two-player leaderboard">
              <h3>Local two-player</h3>
              <p v-if="localLeaderboard.length === 0" class="history-empty">No qualifying wins yet.</p>
              <div v-for="(score, index) in localLeaderboard.slice(0, 5)" :key="`local-${score.name}-${index}`" class="score-row">
                <strong>{{ index + 1 }}. {{ score.name }}</strong><span>{{ score.misses }} misses · {{ score.shots }} shots</span>
              </div>
            </section>
          </div>
          <div v-if="currentProfiles.length" class="profile-records">
            <article v-for="profile in currentProfiles" :key="profile.normalizedName" class="profile-record">
              <h3>{{ profile.name }} <small>{{ profile.lifetimeWins }} wins · {{ profile.currentStreak }} current streak</small></h3>
              <p v-if="profile.achievements.length === 0" class="history-empty">No achievements unlocked yet.</p>
              <div v-else class="achievement-list">
                <span v-for="achievement in profile.achievements" :key="achievement" class="achievement-badge">{{ ACHIEVEMENT_LABELS[achievement] }}</span>
              </div>
            </article>
          </div>
        </section>
      </section>

      <div
        v-if="draggedShip && dragPoint"
        class="drag-preview"
        aria-hidden="true"
        :style="{ left: `${dragPoint.x + 12}px`, top: `${dragPoint.y - 34}px` }"
      >{{ selectedShip?.name }} · {{ orientation }}</div>

      <aside class="intel-rail">
        <section class="intel-card">
          <div class="rail-heading"><span class="rail-icon" aria-hidden="true">⌖</span><span>MISSION STATUS</span></div>
          <div class="status-line"><span class="status-pip" :class="{ active: !isSetup && !isFinished }" /><strong>{{ isLocalHandoff ? 'Private setup handoff' : isLocalReady && !battleStarted ? 'Ready to begin' : isSetup ? (mode === 'local' ? `${setupPlayerId === LOCAL_ONE ? playerOneName : playerTwoName} preparing` : 'Fleet preparation') : isFinished ? `${nameForPlayer(game.winnerId)} wins` : processingAi ? 'Computer firing' : mode === 'local' ? `${nameForPlayer(game.currentPlayerId)}'s turn` : currentShooter?.id === HUMAN ? `${playerOneName}'s turn` : 'Computer turn' }}</strong></div>
          <p>{{ isSetup ? 'Configure the active fleet before the first shot.' : isFinished ? 'Final results are ready for review.' : mode === 'local' ? 'Local two-player match' : `Difficulty: ${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}` }}</p>
          <div v-if="game.firstPlayerId" class="status-metric"><span>FIRST TO FIRE</span><strong>{{ nameForPlayer(game.firstPlayerId) }}</strong></div>
          <div v-if="!isSetup && mode === 'solo'" class="status-metric"><span>YOUR HITS</span><strong>{{ computer.shots.filter((shot) => shot.result !== 'miss').length }} <small>/ 17</small></strong></div>
        </section>
        <section v-if="mode === 'solo'" class="intel-card fleet-intel">
          <div class="rail-heading"><span class="rail-icon" aria-hidden="true">▤</span><span>FLEET MANIFEST</span></div>
          <div v-for="ship in FLEET" :key="ship.id" class="manifest-row">
            <span class="manifest-name">{{ ship.name }}</span>
            <span class="manifest-segments" :class="{ lost: playerOne.ships.some((placed) => placed.id === ship.id && placed.cells.some((cell) => playerOne.shots.some((shot) => shot.row === cell.row && shot.column === cell.column))) }"><i v-for="segment in ship.length" :key="segment" /></span>
          </div>
          <p class="manifest-footnote">Your fleet status</p>
        </section>
        <section class="tip-card">
          <span class="tip-label">TACTICAL NOTE</span>
          <p>Concentrate fire around confirmed hits to locate the full length of each vessel.</p>
          <span class="tip-watermark" aria-hidden="true">⌁</span>
        </section>
        <footer class="rail-footer">FLEET COMMAND <span>·</span> CLASSIC MODE</footer>
      </aside>
    </div>
  </main>
</template>
