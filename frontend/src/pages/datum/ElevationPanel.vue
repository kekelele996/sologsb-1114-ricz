<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { SegmentElevation } from '@/types'
import { ELEVATION_STATUS_META } from '@/types'
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

const filterCaveId = ref<string>('')
const filterStatus = ref<string>('')
const tolerance = ref<number>(DEFAULT_HEIGHT_TOLERANCE)
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  segmentId: '',
  entranceName: '',
  cumulativeVertical: null as number | null,
  note: ''
})

const STATUS_FILTER_OPTIONS = [
  { value: 'draft', label: '待提交' },
  { value: 'confirmed', label: '已认基准' },
  { value: 'pendingRecompute', label: '待重算' },
  { value: 'pendingVerify', label: '待核' }
]

const filtered = computed(() =>
  datumState.elevations.filter((row) => {
    if (row.status === 'unconfirmed') return false
    if (filterCaveId.value && row.caveId !== filterCaveId.value) return false
    if (filterStatus.value && row.status !== filterStatus.value) return false
    return true
  })
)

const segmentById = computed(() => new Map(segmentState.segments.map((segment) => [segment.id, segment])))
const coveredSegmentIds = computed(() => new Set(datumState.elevations.map((row) => row.segmentId)))

function caveName(caveId: string): string {
  return caveState.caves.find((cave) => cave.id === caveId)?.name ?? '未归属洞穴'
}
function segmentLabel(row: SegmentElevation): string {
  const seg = segmentById.value.get(row.segmentId)
  return seg ? `${seg.code}（${seg.startStake} → ${seg.endStake}）` : `洞段已失档 · ${row.segmentId}`
}
function staleVersion(row: SegmentElevation): boolean {
  const entrance = datumState.entrances.find((item) => item.name === row.entranceName)
  return !!entrance && (row.datumSnapshot?.datumVersion ?? 0) < entrance.datumVersion
}
function stationCumulative(segmentId: string): number {
  return sumCumulativeVertical(stationState.stations.filter((station) => station.segmentId === segmentId))
}

function resetForm(): void {
  editingId.value = null
  const first = segmentState.segments.find(
    (segment) =>
      (!filterCaveId.value || segment.caveId === filterCaveId.value) &&
      !coveredSegmentIds.value.has(segment.id)
  )
  form.segmentId = first?.id ?? ''
  form.entranceName = first ? caveState.caves.find((cave) => cave.id === first.caveId)?.name ?? '' : ''
  form.cumulativeVertical = first ? stationCumulative(first.id) : null
  form.note = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: SegmentElevation): void {
  editingId.value = row.id
  form.segmentId = row.segmentId
  form.entranceName = row.entranceName
  form.cumulativeVertical = row.cumulativeVertical
  form.note = row.note
}

function onSegmentChange(segmentId: string): void {
  const seg = segmentById.value.get(segmentId)
  if (!seg) return
  form.cumulativeVertical = stationCumulative(seg.id)
  // 洞口点名默认按归属洞穴名带出，测量员可改成实际洞口
  form.entranceName = caveState.caves.find((cave) => cave.id === seg.caveId)?.name ?? ''
}

async function submit(): Promise<void> {
  const seg = segmentById.value.get(form.segmentId)
  if (!seg) {
    ElMessage.warning('请选择洞段')
    return
  }
  if (!form.entranceName.trim()) {
    ElMessage.warning('请填写洞口点名，测量组按它和登记室对账')
    return
  }
  if (form.cumulativeVertical === null || !Number.isFinite(Number(form.cumulativeVertical))) {
    ElMessage.warning('请填写或自动汇总累计垂距')
    return
  }
  await datumStore.getState().saveElevation(
    {
      segmentId: seg.id,
      caveId: seg.caveId,
      entranceName: form.entranceName,
      cumulativeVertical: Number(form.cumulativeVertical),
      note: form.note
    },
    editingId.value
  )
  dialogVisible.value = false
  ElMessage.success(editingId.value ? '洞段成果已修改，可重新对账' : '洞段成果已保存为待提交')
}

async function reconcileRow(row: SegmentElevation): Promise<void> {
  const updated = await datumStore.getState().reconcileOne(row.id, tolerance.value)
  if (!updated) return
  if (updated.status === 'confirmed') {
    ElMessage.success(`对账通过，终点高程 ${updated.finalElevation} m，已按新基准认定`)
  } else if (updated.status === 'pendingRecompute') {
    ElMessage.warning(`仍需重算：${updated.lastReason}`)
  } else if (updated.status === 'pendingVerify') {
    ElMessage.error(`仍挂待核：${updated.lastReason}`)
  } else {
    ElMessage.info(`未达对账条件：${updated.lastReason}`)
  }
}

async function reconcileAll(): Promise<void> {
  const count = await datumStore.getState().reconcilePending(tolerance.value)
  ElMessage.success(`批量对账完成，本轮新认定 ${count} 个洞段，其余仍挂起`)
}

async function remove(row: SegmentElevation): Promise<void> {
  await ElMessageBox.confirm(`确认删除洞段「${segmentLabel(row)}」的高程成果？现场测点读数不会被删除。`, '删除确认', {
    type: 'warning'
  })
  await datumStore.getState().removeElevation(row.id)
  ElMessage.success('洞段成果已删除，测点读数原样保留')
}
</script>

<template>
  <div>
    <div class="panel-head">
      <p class="panel-tip">
        测量小组保管洞段成果：洞口点名、测点累计垂距、终点高程。<b>只按洞口点名与登记室对账</b>，接测高差对不上先挂待核；重试只动这一段，已按新基准认过的不回退；现场读数始终原样保留。
      </p>
      <el-button type="primary" size="small" @click="openCreate">
        <el-icon><Plus /></el-icon>登记洞段成果
      </el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="filterCaveId" placeholder="全部洞穴" clearable size="small" style="width: 180px">
        <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="filterStatus" placeholder="全部状态" clearable size="small" style="width: 150px">
        <el-option v-for="opt in STATUS_FILTER_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
      </el-select>
      <span class="muted">高差容差(m)</span>
      <el-input-number v-model="tolerance" :min="0.001" :step="0.01" :precision="3" :controls="false" size="small" style="width: 110px" />
      <el-button type="success" plain size="small" @click="reconcileAll">
        <el-icon><Refresh /></el-icon>批量对账（只重试挂起洞段）
      </el-button>
    </div>

    <el-table :data="filtered" border stripe size="small">
      <el-table-column label="洞段" width="190">
        <template #default="{ row }: { row: SegmentElevation }">
          <span class="mono">{{ segmentLabel(row) }}</span>
          <div class="muted">{{ caveName(row.caveId) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="entranceName" label="洞口点名" width="150">
        <template #default="{ row }: { row: SegmentElevation }">
          <span class="mono">{{ row.entranceName }}</span>
          <el-tag v-if="staleVersion(row)" type="warning" size="small" effect="plain" class="ver-tag">基准落后</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="累计垂距(m)" width="110">
        <template #default="{ row }: { row: SegmentElevation }">
          <span v-if="row.cumulativeVertical !== null">{{ row.cumulativeVertical }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="终点高程(m)" width="110">
        <template #default="{ row }: { row: SegmentElevation }">
          <b v-if="row.finalElevation !== null">{{ row.finalElevation }}</b>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }: { row: SegmentElevation }">
          <el-tag :type="ELEVATION_STATUS_META[row.status].type" size="small" effect="dark">
            {{ ELEVATION_STATUS_META[row.status].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="认定基准 / 待处理原因" min-width="260">
        <template #default="{ row }: { row: SegmentElevation }">
          <template v-if="row.datumSnapshot">
            <div class="snap">
              {{ row.datumSnapshot.benchmarkName }} · 洞口海拔 {{ row.datumSnapshot.entranceAltitude }} m ·
              基准 v{{ row.datumSnapshot.datumVersion }}
            </div>
          </template>
          <span v-else class="reason">{{ row.lastReason ?? '尚未对账' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }: { row: SegmentElevation }">
          <el-button
            link
            type="primary"
            size="small"
            :disabled="row.status === 'confirmed' && !staleVersion(row)"
            @click="reconcileRow(row)"
          >
            {{ row.status === 'pendingRecompute' ? '重算' : '对账重试' }}
          </el-button>
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无洞段高程成果，先由测量组登记一条</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑洞段成果' : '登记洞段成果'" width="580px">
      <el-form label-width="110px">
        <el-form-item label="所属洞段" required>
          <el-select
            v-model="form.segmentId"
            :disabled="!!editingId"
            filterable
            placeholder="选择洞段"
            style="width: 100%"
            @change="(value: string) => onSegmentChange(value)"
          >
            <el-option
              v-for="seg in segmentState.segments"
              :key="seg.id"
              :label="`${seg.code}（${caveName(seg.caveId)}）`"
              :value="seg.id"
              :disabled="coveredSegmentIds.has(seg.id) && datumState.elevations.find((row) => row.id === editingId)?.segmentId !== seg.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="洞口点名" required>
          <el-select v-model="form.entranceName" filterable allow-create default-first-option placeholder="选择或输入洞口点名" style="width: 100%">
            <el-option v-for="ent in datumState.entrances" :key="ent.id" :label="ent.name" :value="ent.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="累计垂距(m)" required>
          <el-input-number v-model="form.cumulativeVertical" :precision="3" :controls="false" style="width: 100%" />
          <el-button link type="primary" size="small" @click="form.segmentId && (form.cumulativeVertical = stationCumulative(form.segmentId))">
            按本洞段测点读数自动汇总
          </el-button>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="竖井人工累计、特殊观测情况等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
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
  max-width: 800px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.ver-tag {
  margin-left: 6px;
}
.reason {
  color: #b25c00;
  font-size: 12px;
}
.snap {
  font-size: 12px;
  color: #2f6f5e;
}
</style>
