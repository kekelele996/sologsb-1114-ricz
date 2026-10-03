<script setup lang="ts">
import { computed } from 'vue'
import type { DatumStatus } from '@/types'
import { DATUM_STATUS_LABELS } from '@/types'

const props = withDefaults(
  defineProps<{ status: DatumStatus; size?: 'small' | 'default' | 'large'; count?: number }>(),
  { size: 'small', count: undefined }
)

const tagType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  switch (props.status) {
    case 'confirmed':
      return 'success'
    case 'stale':
      return 'warning'
    case 'pending':
      return 'danger'
    case 'unbackfilled':
      return 'info'
  }
})
</script>

<template>
  <el-tag :type="tagType" :size="size" effect="plain" style="margin-right: 6px">
    {{ DATUM_STATUS_LABELS[status] }}<span v-if="count !== undefined"> × {{ count }}</span>
  </el-tag>
</template>
