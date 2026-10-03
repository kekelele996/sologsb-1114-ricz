<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 画布宽度（像素） */
    width?: number
    /** 画布高度（像素） */
    height?: number
    /** 每格边长（像素） */
    gridSize?: number
    /** 每格代表的实际长度（米） */
    metersPerGrid?: number
    title?: string
  }>(),
  { width: 720, height: 420, gridSize: 24, metersPerGrid: 1, title: '' }
)

const cols = computed(() => Math.floor(props.width / props.gridSize))
const rows = computed(() => Math.floor(props.height / props.gridSize))
const verticals = computed(() => Array.from({ length: cols.value + 1 }, (_, i) => i * props.gridSize))
const horizontals = computed(() => Array.from({ length: rows.value + 1 }, (_, i) => i * props.gridSize))
const rulerText = computed(() => `1 格 = ${props.metersPerGrid} m`)
</script>

<template>
  <div class="grid-canvas">
    <div class="grid-head">
      <span class="title">{{ title }}</span>
      <span class="ruler">{{ rulerText }}</span>
    </div>
    <svg :width="width" :height="height" class="sheet" role="img" :aria-label="title || '坐标纸网格'">
      <rect :width="width" :height="height" fill="#fdfcf7" stroke="#c9d3dc" />
      <g stroke="#dfe7ee" stroke-width="1">
        <line v-for="x in verticals" :key="`v${x}`" :x1="x" :y1="0" :x2="x" :y2="height" />
        <line v-for="y in horizontals" :key="`h${y}`" :x1="0" :y1="y" :x2="width" :y2="y" />
      </g>
      <g stroke="#b6c4d1" stroke-width="1.4">
        <line v-for="(x, i) in verticals" v-show="i % 5 === 0" :key="`V${x}`" :x1="x" :y1="0" :x2="x" :y2="height" />
        <line v-for="(y, i) in horizontals" v-show="i % 5 === 0" :key="`H${y}`" :x1="0" :y1="y" :x2="width" :y2="y" />
      </g>
      <slot />
    </svg>
    <div class="legend">
      <slot name="legend" />
    </div>
  </div>
</template>

<style scoped>
.grid-canvas {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e2e9f0;
  box-shadow: 0 1px 3px rgba(31, 58, 77, 0.06);
}
.grid-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #35506b;
}
.ruler {
  color: #7a8896;
}
.sheet {
  border-radius: 8px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #6b7b8c;
}
</style>
