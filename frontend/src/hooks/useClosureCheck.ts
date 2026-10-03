import { computed, type Ref } from 'vue'
import type { ClosureResult, Station } from '@/types'
import { computeClosure } from '@/utils/survey'

/**
 * 输入某个洞段的测点序列，返回闭合差与误差等级。
 * @param stations 测点序列（响应式）
 * @param threshold 闭合差阈值（米）
 */
export function useClosureCheck(stations: Ref<Station[]>, threshold = 0.25): {
  closure: Ref<number>
  result: Ref<ClosureResult>
  over: Ref<boolean>
  level: Ref<ClosureResult['level']>
} {
  const result = computed<ClosureResult>(() => computeClosure(stations.value, threshold))
  const closure = computed(() => result.value.closure)
  const over = computed(() => result.value.over)
  const level = computed(() => result.value.level)
  return { closure, result, over, level }
}
