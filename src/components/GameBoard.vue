<script setup>
const props = defineProps({
  player: { type: Object, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  showShips: { type: Boolean, default: false },
  setupMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  draggedShip: { type: String, default: '' },
  placementPreview: { type: Object, default: null },
});

const emit = defineEmits([
  'cell', 'ship-pointerdown', 'ship-pointermove', 'ship-pointerup', 'ship-pointercancel', 'rotate',
]);

function shipStyle(ship) {
  const start = ship.cells[0];
  return {
    left: `${start.column * 10}%`,
    top: `${start.row * 10}%`,
    width: `${ship.orientation === 'horizontal' ? ship.length * 10 : 10}%`,
    height: `${ship.orientation === 'vertical' ? ship.length * 10 : 10}%`,
  };
}

function shipAt(row, column) {
  return props.player.ships.find(({ cells }) => (
    cells.some((cell) => cell.row === row && cell.column === column)
  ));
}

function shotAt(row, column) {
  return props.player.shots.find((shot) => shot.row === row && shot.column === column);
}

function classes(row, column) {
  const shot = shotAt(row, column);
  const ship = shipAt(row, column);
  const previewed = props.placementPreview?.cells.some((cell) => (
    cell.row === row && cell.column === column
  ));
  return {
    'is-ship': props.showShips && ship,
    'is-hit': shot && shot.result !== 'miss',
    'is-miss': shot?.result === 'miss',
    'is-sunk': shot?.result === 'sunk',
    'is-setup-target': props.setupMode && props.draggedShip,
    'placement-valid': previewed && props.placementPreview.valid,
    'placement-invalid': previewed && !props.placementPreview.valid,
  };
}

function label(row, column) {
  const shot = shotAt(row, column);
  const ship = props.showShips ? shipAt(row, column) : null;
  const status = shot
    ? (shot.result === 'miss' ? 'miss' : `${shot.result} ${shot.shipName ?? 'ship'}`)
    : ship ? `${ship.name} ship` : 'open water';
  return `Row ${row + 1}, column ${column + 1}, ${status}`;
}
</script>

<template>
  <section class="board-panel">
    <header class="board-heading">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
      <span class="board-count">{{ player.shots.length }} shots</span>
    </header>
    <div class="board-wrap">
      <div class="axis axis-top" aria-hidden="true">
        <span v-for="column in 10" :key="column">{{ String.fromCharCode(64 + column) }}</span>
      </div>
      <div class="board-row">
        <div class="axis axis-side" aria-hidden="true">
          <span v-for="row in 10" :key="row">{{ row }}</span>
        </div>
        <div class="game-board" role="grid" :aria-label="`${title} 10 by 10 board`">
          <button
            v-for="cell in 100"
            :key="cell"
            class="cell"
            :class="classes(Math.floor((cell - 1) / 10), (cell - 1) % 10)"
            type="button"
            role="gridcell"
            :aria-label="label(Math.floor((cell - 1) / 10), (cell - 1) % 10)"
            :disabled="disabled"
            :data-placement-cell="setupMode ? '' : undefined"
            :data-row="Math.floor((cell - 1) / 10)"
            :data-column="(cell - 1) % 10"
            @click="emit('cell', { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
            @pointerdown="setupMode && emit('ship-pointerdown', $event, { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
            @pointermove="setupMode && emit('ship-pointermove', $event)"
            @pointerup="setupMode && emit('ship-pointerup', $event)"
            @pointercancel="emit('ship-pointercancel')"
            @lostpointercapture="emit('ship-pointercancel')"
            @contextmenu="setupMode && $event.preventDefault(); setupMode && emit('rotate', { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
            @keydown.r.prevent="setupMode && emit('rotate', { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
          >
            <span v-if="shotAt(Math.floor((cell - 1) / 10), (cell - 1) % 10)?.result === 'miss'" class="miss-dot" />
            <span v-else-if="shotAt(Math.floor((cell - 1) / 10), (cell - 1) % 10)" class="hit-mark">×</span>
          </button>
          <div v-if="showShips" class="ship-layer" aria-hidden="true">
            <svg
              v-for="ship in player.ships"
              :key="ship.id"
              class="board-ship"
              :data-ship-id="ship.id"
              :style="shipStyle(ship)"
              :viewBox="ship.orientation === 'horizontal' ? '0 0 100 24' : '0 0 24 100'"
              preserveAspectRatio="none"
            >
              <g :transform="ship.orientation === 'vertical' ? 'translate(24 0) rotate(90)' : undefined">
                <path class="ship-hull" d="M 4 5 L 76 3 Q 88 4 98 12 Q 88 20 76 21 L 4 19 Q 1 12 4 5 Z" />
                <path class="ship-deck" d="M 10 8 L 73 7 L 86 12 L 73 17 L 10 16 Z" />
                <rect class="ship-bridge" x="37" y="8" width="19" height="8" rx="2" />
                <path class="ship-detail" d="M 63 8 L 63 16 M 68 8 L 68 16 M 47 5 L 47 19 M 17 12 L 29 12" />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
