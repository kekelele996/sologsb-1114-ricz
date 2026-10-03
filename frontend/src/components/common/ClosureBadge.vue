<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ClosureResult } from '@/types'

const props = withDefaults(
  defineProps<{
    closure: number
    threshold?: number
    level?: ClosureResult['level']
    detail?: string
    count?: number
  }>(),
  { threshold: 0.25, level: '优', detail: '', count: 0 }
)

const expanded = ref(false)
const over = computed(() => props.closure >= props.threshold)
const tone = computed(() => (over.value ? 'danger' : props.level === '良' ? 'warning' : 'success'))
const percent = computed(() => Math.min(100, Math.round((props.closure / props.threshold) * 100)))
</script>

<template>
  <div class="closure-badge" :class="{ over }">
    <el-tag :type="tone" effect="dark" size="small">闭合差 {{ closure.toFixed(3) }} m</el-tag>
    <el-tag :type="over ? 'danger' : 'info'" size="small" effect="plain">阈值 {{ threshold }} m</el-tag>
    <el-tag size="small" effect="plain">{{ level }}</el-tag>
    <span v-if="count" class="count">{{ count }} 站</span>
    <el-progress
      class="bar"
      :percentage="percent"
      :status="over ? 'exception' : 'success'"
      :show-text="false"
      :stroke-width="6"
    />
    <el-button link type="primary" size="small" @click="expanded = !expanded">
      {{ expanded ? '收起计算过程' : '展开计算过程' }}
    </el-button>
    <div v-if="expanded" class="detail">
      <p>{{ detail || '暂无计算过程' }}</p>
      <p class="tip">{{ over ? '闭合差超过阈值，建议复测或重新分配误差。' : '闭合差在阈值内，导线可用。' }}</p>
    </div>
  </div>
</template>

<style scoped>
.closure-badge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #f5f8fb;
  border: 1px solid #dde6ee;
}
.closure-badge.over {
  background: #fdf2f2;
  border-color: #f0c2c2;
}
.count {
  font-size: 12px;
  color: #6b7b8c;
}
.bar {
  width: 120px;
}
.detail {
  flex-basis: 100%;
  font-size: 12px;
  color: #4a5b6b;
  line-height: 1.7;
}
.detail p {
  margin: 2px 0;
}
.tip {
  color: #8a6d1f;
}
</style>
