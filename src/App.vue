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
import { getReplayCursor, getReplayPlayer } from './history/replay.js';

const HUMAN = 'captain';
const COMPUTER = 'computer';
const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', detail: 'Random open waters' },
  { id: 'medium', name: 'Medium', detail: 'Hunts around hits' },
  { id: 'hard', name: 'Hard', detail: 'Probability targeting' },
];

const game = ref(createGame([HUMAN, COMPUTER]));
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
const processingAi = ref(false);
const replayMatch = ref(null);
const replayCursor = ref(0);
const replayPlaying = ref(false);
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
const selectedShip = computed(() => FLEET.find(({ id }) => id === (draggedShip.value || selectedShipId.value)));
const placedShipIds = computed(() => new Set(human.value.ships.map(({ id }) => id)));
const remainingShips = computed(() => FLEET.filter(({ id }) => !placedShipIds.value.has(id)));
const isSetup = computed(() => game.value.phase === 'setup');
const isFinished = computed(() => game.value.phase === 'finished');
const currentShooter = computed(() => (
  game.value.players.find(({ id }) => id === game.value.currentPlayerId)
));
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
  if (placedShipIds.value.has(shipId)) return;
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
  if (!event.isPrimary || event.button !== 0 || !isSetup.value) return;
  suppressShipClick = false;
  selectShip(shipId);
  const placed = human.value.ships.find((ship) => ship.id === shipId);
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
    operation(game.value, HUMAN, ship.id, position, pointerDrag.orientation);
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
  const ship = human.value.ships.find(({ cells }) => (
    cells.some((cell) => cell.row === position.row && cell.column === position.column)
  ));
  if (ship) startShipDrag(event, ship.id, position);
}

function rotateBoardShip(position) {
  if (!isSetup.value) return;
  const ship = human.value.ships.find(({ cells }) => (
    cells.some((cell) => cell.row === position.row && cell.column === position.column)
  ));
  if (!ship) return;
  cancelShipDrag();
  try {
    game.value = rotateShip(game.value, HUMAN, ship.id);
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
  if (!isSetup.value || !shipId) return;
  try {
    const operation = placedShipIds.value.has(shipId) ? moveShip : placeShip;
    game.value = operation(game.value, HUMAN, shipId, position, shipOrientation);
    const nextShip = FLEET.find(({ id }) => !game.value.players[0].ships.some((ship) => ship.id === id));
    selectedShipId.value = nextShip?.id ?? '';
    notice.value = nextShip
      ? `${FLEET.find(({ id }) => id === shipId).name} placed. Now place your ${nextShip.name}.`
      : 'Fleet ready. Start the engagement when you are ready.';
    error.value = '';
  } catch (caught) {
    presentError(caught);
  }
}

function onCell(position) {
  if (suppressShipClick) {
    suppressShipClick = false;
    return;
  }
  if (isSetup.value) {
    if (human.value.ships.some(({ cells }) => cells.some((cell) => (
      cell.row === position.row && cell.column === position.column
    )))) return;
    placeSelected(position, draggedShip.value || selectedShipId.value);
    draggedShip.value = '';
    return;
  }
  if (game.value.phase === 'playing' && game.value.currentPlayerId === HUMAN && !processingAi.value) {
    fireAt(position);
  }
}

function randomizePlayerFleet() {
  try {
    game.value = randomizeFleet(game.value, HUMAN);
    selectedShipId.value = '';
    notice.value = 'Fleet randomized. Review the layout or start the engagement.';
    error.value = '';
  } catch (caught) {
    presentError(caught);
  }
}

function clearPlayerFleet() {
  try {
    game.value = clearFleet(game.value, HUMAN);
    selectedShipId.value = FLEET[0].id;
    notice.value = 'Fleet cleared. Select a ship and place it on the grid.';
    error.value = '';
  } catch (caught) {
    presentError(caught);
  }
}

function beginGame() {
  try {
    if (remainingShips.value.length > 0) {
      throw new RuleError('INCOMPLETE_FLEET', 'Place every ship or randomize your fleet first.');
    }
    let prepared = randomizeFleet(game.value, COMPUTER);
    game.value = startGame(prepared);
    shotLog.value = [];
    selectedShipId.value = '';
    notice.value = `${game.value.firstPlayerId === HUMAN ? 'You' : 'The computer'} fire first.`;
    error.value = '';
    if (game.value.currentPlayerId === COMPUTER) aiTurns.start();
  } catch (caught) {
    presentError(caught);
  }
}

function createMatchRecord() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
    difficulty: difficulty.value,
    game: game.value,
    shotLog: shotLog.value,
  };
}

function finishMatch() {
  notice.value = game.value.winnerId === HUMAN ? 'Victory. The opposing fleet is sunk.' : 'Defeat. Your fleet has been sunk.';
  try {
    history.value = saveMatch(createMatchRecord());
    historyError.value = '';
  } catch (caught) {
    historyError.value = caught.message;
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

function describeShot(shooterId, shot) {
  const shooterName = shooterId === HUMAN ? 'Your shot' : 'Computer shot';
  if (shot.result === 'miss') return `${shooterName}: miss at ${String.fromCharCode(65 + shot.column)}${shot.row + 1}.`;
  if (shot.result === 'sunk') return `${shooterName}: ${shot.shipName} sunk!`;
  return `${shooterName}: direct hit.`;
}

function fireAt(position) {
  try {
    const shot = recordShot(HUMAN, COMPUTER, position);
    notice.value = describeShot(HUMAN, shot);
    error.value = '';
    if (game.value.phase === 'finished') finishMatch();
    else if (game.value.currentPlayerId === COMPUTER) aiTurns.start();
  } catch (caught) {
    presentError(caught);
  }
}

function restart() {
  aiTurns.cancel();
  cancelShipDrag();
  stopReplay();
  replayMatch.value = null;
  game.value = createGame([HUMAN, COMPUTER]);
  shotLog.value = [];
  selectedShipId.value = FLEET[0].id;
  orientation.value = 'horizontal';
  notice.value = 'New engagement. Place your fleet or randomize it.';
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

function stopReplay() {
  replayPlaying.value = false;
  if (replayTimer) {
    window.clearInterval(replayTimer);
    replayTimer = undefined;
  }
}

function openReplay(match) {
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
  return match.game.winnerId === HUMAN ? 'You won' : 'Computer won';
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

        <section v-if="isSetup && !replayMatch" class="setup-panel" aria-labelledby="setup-title">
          <div class="section-title">
            <div><span class="step-tag">01 / SETUP</span><h2 id="setup-title">Configure engagement</h2></div>
            <span class="fleet-progress">{{ human.ships.length }} <span>/ 5 vessels</span></span>
          </div>
          <fieldset class="difficulty-select">
            <legend>Computer difficulty</legend>
            <label v-for="option in DIFFICULTIES" :key="option.id" class="difficulty-option" :class="{ active: difficulty === option.id }">
              <input v-model="difficulty" type="radio" name="difficulty" :value="option.id">
              <span class="difficulty-dot" />
              <span><strong>{{ option.name }}</strong><small>{{ option.detail }}</small></span>
            </label>
          </fieldset>

          <div class="fleet-controls">
            <div class="fleet-heading">
              <div><span class="step-tag">02 / FLEET</span><h2>Your vessels</h2></div>
              <button class="text-button" type="button" @click="orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal'">
                <span class="rotate-icon" aria-hidden="true">↻</span> {{ orientation === 'horizontal' ? 'Horizontal' : 'Vertical' }}
              </button>
            </div>
            <p class="hint">Click or drag to place. Drag ships on your board to move them; right-click a ship (or focus its cell and press R) to rotate it. Red previews cannot be placed.</p>
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
          </div>
        </section>

        <div v-if="error" class="alert error-alert" role="alert"><span aria-hidden="true">!</span>{{ error }}</div>
        <div v-else-if="notice && !replayMatch" class="alert notice-alert" role="status"><span class="notice-icon" aria-hidden="true">◈</span>{{ processingAi ? 'Computer is choosing a target…' : notice }}</div>
        <div v-if="historyError" class="alert error-alert history-alert" role="alert"><span aria-hidden="true">!</span>{{ historyError }}</div>

        <div v-if="!replayMatch" class="boards" :class="{ 'boards-setup': isSetup }">
          <GameBoard
            :player="human"
            :title="isSetup ? 'Your waters' : 'Your fleet'"
            :subtitle="isSetup ? 'Place your ships on the grid' : 'Incoming fire is shown here'"
            :show-ships="true"
            :setup-mode="isSetup"
            :disabled="!isSetup"
            :dragged-ship="draggedShip"
            :placement-preview="placementPreview"
            @cell="onCell"
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
            @cell="onCell"
          />
        </div>

        <section v-if="isSetup && !replayMatch" class="launch-row">
          <div class="launch-note"><span class="launch-icon" aria-hidden="true">⌖</span><span>Ships can touch, but cannot overlap.<small>{{ remainingShips.length ? `${remainingShips.length} vessel${remainingShips.length === 1 ? '' : 's'} left to place` : 'All vessels are positioned and ready' }}</small></span></div>
          <button class="primary-button" type="button" :disabled="remainingShips.length > 0" @click="beginGame">Begin engagement <span aria-hidden="true">→</span></button>
        </section>

        <section v-if="isFinished && !replayMatch" class="result-panel">
          <div class="result-icon">{{ game.winnerId === HUMAN ? '✦' : '◈' }}</div>
          <div><span class="step-tag">MISSION REPORT</span><h2>{{ game.winnerId === HUMAN ? 'Victory at sea' : 'Fleet lost' }}</h2><p>{{ game.winnerId === HUMAN ? 'You successfully located and sank the entire opposing fleet.' : 'The opposing fleet has sunk your final vessel.' }} The enemy fleet is now revealed.</p></div>
          <div class="result-actions"><button class="primary-button" type="button" @click="restart">New engagement <span aria-hidden="true">→</span></button><button class="secondary-button" type="button" @click="openReplay(createMatchRecord())">Review match</button></div>
        </section>

        <section v-if="replayMatch" class="replay-panel">
          <div class="replay-header"><div><span class="step-tag">MATCH PLAYBACK</span><h2>{{ replayWinner(replayMatch) }} · {{ replayMatch.difficulty }} AI</h2></div><button class="quiet-button" type="button" @click="replayMatch = null; stopReplay()">Close replay</button></div>
          <div class="replay-controls">
            <button class="icon-button" type="button" aria-label="Previous shot" :disabled="replayCursor === 0" @click="stepReplay(-1)">‹</button>
            <button class="play-button" type="button" :aria-label="replayPlaying ? 'Pause replay' : 'Play replay'" @click="toggleReplay">{{ replayPlaying ? 'Ⅱ' : '▶' }}</button>
            <button class="icon-button" type="button" aria-label="Next shot" :disabled="replayCursor >= replayShots.length" @click="stepReplay(1)">›</button>
            <span>{{ replayPosition }}</span>
            <input v-model.number="replayCursor" type="range" min="0" :max="replayShots.length" aria-label="Replay shot position" @input="stopReplay">
          </div>
          <p v-if="replayCurrentShot" class="replay-caption">
            {{ replayCurrentShot.shooterId === HUMAN ? 'You' : 'Computer' }} fired at
            {{ String.fromCharCode(65 + replayCurrentShot.column) }}{{ replayCurrentShot.row + 1 }}:
            {{ replayCurrentShot.result === 'sunk' ? `${replayCurrentShot.shipName} sunk` : replayCurrentShot.result }}.
          </p>
          <div class="boards replay-boards">
            <GameBoard :player="replayBoard(HUMAN)" title="Your fleet" subtitle="Final fleet layout" :show-ships="true" disabled />
            <GameBoard :player="replayBoard(COMPUTER)" title="Opposing fleet" subtitle="Revealed after match" :show-ships="true" disabled />
          </div>
        </section>

        <section v-if="!replayMatch && (history.length || historyError)" class="history-panel">
          <div class="history-heading"><div><span class="step-tag">ARCHIVE</span><h2>Recent engagements</h2></div><button class="quiet-button" type="button" @click="clearHistory">Clear history</button></div>
          <p v-if="history.length === 0" class="history-empty">No saved match history is available.</p>
          <button v-for="match in history" :key="match.id" class="history-row" type="button" @click="openReplay(match)">
            <span class="history-outcome" :class="{ won: match.game.winnerId === HUMAN }">{{ match.game.winnerId === HUMAN ? 'W' : 'L' }}</span>
            <span class="history-description"><strong>{{ replayWinner(match) }}</strong><small>{{ formatDate(match.createdAt) }} · {{ match.difficulty }} difficulty</small></span>
            <span class="history-arrow">↗</span>
          </button>
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
          <div class="status-line"><span class="status-pip" :class="{ active: !isSetup && !isFinished }" /><strong>{{ isSetup ? 'Fleet preparation' : isFinished ? 'Engagement ended' : processingAi ? 'Computer firing' : currentShooter?.id === HUMAN ? 'Your turn' : 'Computer turn' }}</strong></div>
          <p>{{ isSetup ? 'Configure your fleet before the first shot.' : isFinished ? 'Final results are ready for review.' : `Difficulty: ${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}` }}</p>
          <div v-if="!isSetup" class="status-metric"><span>FIRST TO FIRE</span><strong>{{ game.firstPlayerId === HUMAN ? 'You' : 'Computer' }}</strong></div>
          <div v-if="!isSetup" class="status-metric"><span>YOUR HITS</span><strong>{{ computer.shots.filter((shot) => shot.result !== 'miss').length }} <small>/ 17</small></strong></div>
        </section>
        <section class="intel-card fleet-intel">
          <div class="rail-heading"><span class="rail-icon" aria-hidden="true">▤</span><span>FLEET MANIFEST</span></div>
          <div v-for="ship in FLEET" :key="ship.id" class="manifest-row">
            <span class="manifest-name">{{ ship.name }}</span>
            <span class="manifest-segments" :class="{ lost: human.ships.some((placed) => placed.id === ship.id && placed.cells.some((cell) => human.shots.some((shot) => shot.row === cell.row && shot.column === cell.column))) }"><i v-for="segment in ship.length" :key="segment" /></span>
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
