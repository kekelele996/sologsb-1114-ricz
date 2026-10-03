<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { SegmentElevation } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { datumStore } from '@/stores/datumStore'
import { DEFAULT_HEIGHT_TOLERANCE, sumCumulativeVertical } from '@/utils/datum'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)
const datumState = useStore(datumStore)

const activeId = ref<string | null>(null)
const form = reactive({
  entranceName: '',
  cumulativeVertical: null as number | null
})
const tolerance = ref<number>(DEFAULT_HEIGHT_TOLERANCE)

const unconfirmed = (): SegmentElevation[] => datumState.elevations.filter((row) => row.status === 'unconfirmed')

function segmentLabel(row: SegmentElevation): string {
  const seg = segmentState.segments.find((item) => item.id === row.segmentId)
  return seg ? `${seg.code}（${seg.startStake} → ${seg.endStake}）` : row.segmentId
}
function caveName(row: SegmentElevation): string {
  return caveState.caves.find((cave) => cave.id === row.caveId)?.name ?? '未归属洞穴'
}

function startAssign(row: SegmentElevation): void {
  activeId.value = row.id
  const seg = segmentState.segments.find((item) => item.id === row.segmentId)
  const own = stationState.stations.filter((station) => station.segmentId === row.segmentId)
  form.entranceName = seg ? caveState.caves.find((cave) => cave.id === seg.caveId)?.name ?? '' : ''
  form.cumulativeVertical = own.length > 0 ? sumCumulativeVertical(own) : null
}

async function submitAssign(): Promise<void> {
  if (!activeId.value) return
  if (!form.entranceName.trim()) {
    ElMessage.warning('请指认洞口点名')
    return
  }
  if (form.cumulativeVertical === null || !Number.isFinite(Number(form.cumulativeVertical))) {
    ElMessage.warning('请补累计垂距，否则仍无法按洞口海拔回填')
    return
  }
  await datumStore.getState().assignUnconfirmed(activeId.value, form.entranceName, Number(form.cumulativeVertical), tolerance.value)
  activeId.value = null
  ElMessage.success('已按指认洞口重新回填并入账，若仍不达标会继续挂待核')
}
</script>

<template>
  <div>
    <div class="panel-head">
      <p class="panel-tip">
        旧数据里的洞段没有接测基准，升级时已按<b>当时的洞口海拔</b>回填；下面这些是<b>回填不上、单列等确认</b>的：人工指认洞口点名、补齐累计垂距后再入账。
      </p>
      <el-tag type="warning" effect="dark" size="large">待确认 {{ unconfirmed().length }} 段</el-tag>
    </div>

    <el-table :data="unconfirmed()" border stripe size="small">
      <el-table-column label="洞段" min-width="220">
        <template #default="{ row }: { row: SegmentElevation }">
          <span class="mono">{{ segmentLabel(row) }}</span>
          <div class="muted">{{ caveName(row) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="entranceName" label="原始洞口点名" width="170" />
      <el-table-column label="回填失败原因" min-width="260">
        <template #default="{ row }: { row: SegmentElevation }">
          <span class="reason">{{ row.lastReason ?? row.note }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }: { row: SegmentElevation }">
          <el-button link type="primary" size="small" @click="startAssign(row)">指认并回填</el-button>
        </template>
      </el-table-column>
      <template #empty>没有回填不上的旧洞段，全部旧数据都已按当时洞口海拔回填</template>
    </el-table>

    <el-dialog v-model="activeId" title="回填待确认 · 人工指认" width="520px" :close-on-click-modal="false">
      <el-form label-width="120px">
        <el-alert type="warning" :closable="false" show-icon class="alert" title="按当时的洞口海拔回填，请确认指认的洞口与读数属于同一洞口" />
        <el-form-item label="洞口点名" required>
          <el-select v-model="form.entranceName" filterable allow-create default-first-option style="width: 100%">
            <el-option v-for="ent in datumState.entrances" :key="ent.id" :label="ent.name" :value="ent.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="累计垂距(m)" required>
          <el-input-number v-model="form.cumulativeVertical" :precision="3" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="高差容差(m)">
          <el-input-number v-model="tolerance" :min="0.001" :step="0.01" :precision="3" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="activeId = null">取消</el-button>
        <el-button type="primary" @click="submitAssign">指认并入账</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-tip {
  margin: 0;
  font-size: 13px;
  color: #6b7b8c;
  line-height: 1.7;
  max-width: 780px;
}
.reason {
  color: #b25c00;
  font-size: 12px;
}
.alert {
  margin-bottom: 14px;
}
</style>
