<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatDms, isValidBearing, isValidDip, normalizeBearing, parseAngle } from '@/utils/survey'

const props = withDefaults(
  defineProps<{
    /** 绑定值：十进制度 */
    modelValue: number
    /** bearing = 方位角 0-360；dip = 倾角 -90 ~ 90 */
    kind?: 'bearing' | 'dip'
    label?: string
    placeholder?: string
    disabled?: boolean
  }>(),
  { kind: 'bearing', label: '', placeholder: '如 123.5 或 123°30′00″', disabled: false }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
  (event: 'invalid', message: string): void
}>()

const text = ref<string>(String(props.modelValue ?? 0))
const dmsText = computed(() => formatDms(props.modelValue ?? 0))
const valid = computed(() =>
  props.kind === 'bearing' ? isValidBearing(props.modelValue) : isValidDip(props.modelValue)
)

watch(
  () => props.modelValue,
  (value) => {
    const parsed = parseAngle(text.value)
    if (parsed === null || Math.abs(parsed - value) > 1e-6) {
      text.value = String(value)
    }
  }
)

function commit(): void {
  const parsed = parseAngle(text.value)
  if (parsed === null) {
    emit('invalid', '角度格式无法解析')
    return
  }
  const normalized = props.kind === 'bearing' ? normalizeBearing(parsed) : parsed
  if (props.kind === 'bearing' && !isValidBearing(normalized)) {
    emit('invalid', '方位角必须在 0°–360° 之间')
    return
  }
  if (props.kind === 'dip' && !isValidDip(normalized)) {
    emit('invalid', '倾角必须在 -90°–90° 之间')
    return
  }
  emit('update:modelValue', Number(normalized.toFixed(4)))
}
</script>

<template>
  <div class="bearing-input">
    <el-input
      v-model="text"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="{ 'is-invalid': !valid }"
      @blur="commit"
      @keyup.enter="commit"
    >
      <template v-if="label" #prepend>{{ label }}</template>
      <template #append>°</template>
    </el-input>
    <div class="hint">
      <span class="dms">{{ dmsText }}</span>
      <el-tag v-if="!valid" type="danger" size="small" effect="dark">超范围</el-tag>
      <span v-else class="ok">⇄ 度分秒 / 十进制</span>
    </div>
  </div>
</template>

<style scoped>
.bearing-input {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  color: #7a8896;
}
.dms {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #35506b;
}
.ok {
  color: #7a8896;
}
:deep(.is-invalid .el-input__wrapper) {
  box-shadow: 0 0 0 1px #d64545 inset;
}
</style>
