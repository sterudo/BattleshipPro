<script setup>
const props = defineProps({
  player: { type: Object, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  showShips: { type: Boolean, default: false },
  setupMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  draggedShip: { type: String, default: '' },
});

const emit = defineEmits(['cell', 'drop']);

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
  return {
    'is-ship': props.showShips && ship,
    'is-hit': shot && shot.result !== 'miss',
    'is-miss': shot?.result === 'miss',
    'is-sunk': shot?.result === 'sunk',
    'is-setup-target': props.setupMode && props.draggedShip,
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
            @click="emit('cell', { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
            @dragover.prevent
            @drop.prevent="emit('drop', { row: Math.floor((cell - 1) / 10), column: (cell - 1) % 10 })"
          >
            <span v-if="shotAt(Math.floor((cell - 1) / 10), (cell - 1) % 10)?.result === 'miss'" class="miss-dot" />
            <span v-else-if="shotAt(Math.floor((cell - 1) / 10), (cell - 1) % 10)" class="hit-mark">×</span>
            <span v-else-if="showShips && shipAt(Math.floor((cell - 1) / 10), (cell - 1) % 10)" class="ship-dot" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
