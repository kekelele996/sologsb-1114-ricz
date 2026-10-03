<script setup lang="ts">
import { computed } from 'vue'
import { SEGMENT_TYPE_COLORS, type SegmentType } from '@/types'

const props = withDefaults(
  defineProps<{
    type: SegmentType
    /** 是否展示洞段编号前缀 */
    code?: string
    /** 已闭合标记 */
    closed?: boolean
    size?: 'small' | 'default'
  }>(),
  { code: '', closed: false, size: 'default' }
)

const color = computed(() => SEGMENT_TYPE_COLORS[props.type] ?? '#6b7280')
</script>

<template>
  <span class="segment-tag" :class="`is-${size}`" :style="{ '--tag-color': color }">
    <i class="dot" />
    <span class="label">{{ code ? `${code} · ` : '' }}{{ type }}</span>
    <span v-if="closed" class="closed">已闭合</span>
  </span>
</template>

<style scoped>
.segment-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 20px;
  color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tag-color) 40%, transparent);
  white-space: nowrap;
}
.segment-tag.is-small {
  font-size: 12px;
  padding: 0 8px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tag-color);
}
.closed {
  font-size: 11px;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(46, 125, 50, 0.16);
  color: #2e7d32;
}
</style>
