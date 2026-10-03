<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Cave, DatumStatus, Segment, SegmentType } from '@/types'
import { DATUM_STATUS_LABELS, SEGMENT_TYPES, segmentLength } from '@/types'
import SegmentTag from '@/components/common/SegmentTag.vue'
import DatumTag from '@/components/common/DatumTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { DATUM_TOLERANCE, cumulativeVerticalOf } from '@/utils/datum'
import { stakeRangeOverlap, stakeToNumber } from '@/utils/survey'
import { uid } from '@/utils/id'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)

const filterCaveId = ref<string>('')
const filterType = ref<SegmentType | ''>('')
const filterDatum = ref<DatumStatus | ''>('')
const rangeStart = ref<number | undefined>(undefined)
const rangeEnd = ref<number | undefined>(undefined)
const selectedIds = ref<string[]>([])
const batchType = ref<SegmentType>('廊道')

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const backfillTarget = ref<Segment | null>(null)
const backfillAltitude = ref<number>(0)

const DATUM_STATUS_ORDER: DatumStatus[] = ['confirmed', 'stale', 'pending', 'unbackfilled']

const form = reactive({
  caveId: '',
  code: '',
  startStake: 'K0+000',
  endStake: 'K0+050',
  type: '廊道' as SegmentType,
  avgWidth: 1.5,
  avgHeight: 2,
  slopeTrend: '',
  closed: false,
  sketchNo: '',
  entranceCode: '',
  datumLevelDelta: null as number | null
})

const filtered = computed(() =>
  segmentState.segments.filter((segment) => {
    if (filterCaveId.value && segment.caveId !== filterCaveId.value) return false
    if (filterType.value && segment.type !== filterType.value) return false
    if (filterDatum.value && segment.datumStatus !== filterDatum.value) return false
    if (rangeStart.value !== undefined || rangeEnd.value !== undefined) {
      const lo = rangeStart.value ?? Number.NEGATIVE_INFINITY
      const hi = rangeEnd.value ?? Number.POSITIVE_INFINITY
      if (!stakeRangeOverlap(stakeToNumber(segment.startStake), stakeToNumber(segment.endStake), lo, hi)) return false
    }
    return true
  })
)

const totalLength = computed(() =>
  Math.round(filtered.value.reduce((sum, segment) => sum + segmentLength(segment), 0) * 10) / 10
)

const datumSummary = computed(() => {
  const summary = { confirmed: 0, stale: 0, pending: 0, unbackfilled: 0 }
  for (const segment of segmentState.segments) summary[segment.datumStatus] += 1
  return summary
})

function caveOf(caveId: string): Cave | undefined {
  return caveState.caves.find((cave) => cave.id === caveId)
}

function caveName(caveId: string): string {
  return caveOf(caveId)?.name ?? '未归属洞穴'
}

/** 登记室侧该洞口当前的接测高差（洞口海拔 − 水准点海拔） */
function registryDelta(segment: Segment): number | null {
  const cave = caveOf(segment.caveId)
  if (!cave || cave.benchmarkAltitude === null) return null
  return Math.round((cave.altitude - cave.benchmarkAltitude) * 1000) / 1000
}

function stationCount(segmentId: string): number {
  return stationState.stations.filter((station) => station.segmentId === segmentId).length
}

/** 现场读数实时累计垂距（读数原样保留，重算时才落账） */
function liveVertical(segment: Segment): number | null {
  const rows = stationState.stations.filter((station) => station.segmentId === segment.id)
  return cumulativeVerticalOf(rows)
}

function verticalDelta(segment: Segment): number | null {
  const a = registryDelta(segment)
  const b = liveVertical(segment)
  if (a === null || b === null) return null
  return Math.round((a - b) * 1000) / 1000
}

function resetForm(): void {
  const cave = caveState.caves[0]
  editingId.value = null
  form.caveId = cave?.id ?? ''
  form.code = `C-${String(segmentState.segments.length + 1).padStart(2, '0')}`
  form.startStake = 'K0+000'
  form.endStake = 'K0+050'
  form.type = '廊道'
  form.avgWidth = 1.5
  form.avgHeight = 2
  form.slopeTrend = ''
  form.closed = false
  form.sketchNo = ''
  form.entranceCode = cave?.entranceCode ?? ''
  form.datumLevelDelta = cave && cave.benchmarkAltitude !== null ? cave.altitude - cave.benchmarkAltitude : null
}

/** 切换归属洞穴时自动带上该洞口点名，便于两边对账 */
function syncEntranceFromCave(): void {
  const cave = caveOf(form.caveId)
  if (cave) {
    form.entranceCode = cave.entranceCode
    form.datumLevelDelta = cave.benchmarkAltitude === null ? null : cave.altitude - cave.benchmarkAltitude
  }
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(segment: Segment): void {
  editingId.value = segment.id
  form.caveId = segment.caveId
  form.code = segment.code
  form.startStake = segment.startStake
  form.endStake = segment.endStake
  form.type = segment.type
  form.avgWidth = segment.avgWidth
  form.avgHeight = segment.avgHeight
  form.slopeTrend = segment.slopeTrend
  form.closed = segment.closed
  form.sketchNo = segment.sketchNo
  form.entranceCode = segment.entranceCode
  form.datumLevelDelta = segment.datumLevelDelta
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.caveId) {
    ElMessage.warning('请选择归属洞穴')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写洞段编号')
    return
  }
  if (stakeToNumber(form.endStake) <= stakeToNumber(form.startStake)) {
    ElMessage.warning('结束桩号必须大于起始桩号')
    return
  }
  if (!form.entranceCode.trim()) {
    ElMessage.warning('请填写对账用洞口点名')
    return
  }
  const existing = segmentState.segments.find((item) => item.id === editingId.value)
  const segment: Segment = {
    id: existing?.id ?? uid('seg'),
    caveId: form.caveId,
    code: form.code.trim(),
    startStake: form.startStake.trim(),
    endStake: form.endStake.trim(),
    type: form.type,
    avgWidth: Number(form.avgWidth) || 0,
    avgHeight: Number(form.avgHeight) || 0,
    slopeTrend: form.slopeTrend.trim(),
    closed: form.closed,
    sketchNo: form.sketchNo.trim(),
    entranceCode: form.entranceCode.trim(),
    datumLevelDelta:
      form.datumLevelDelta === null || Number.isNaN(Number(form.datumLevelDelta))
        ? null
        : Number(form.datumLevelDelta),
    // 以下基准生命周期字段：新建时给初始值，编辑时沿用旧值（store.save 决定是否退回待核）
    cumulativeVertical: existing?.cumulativeVertical ?? null,
    datumStatus: existing?.datumStatus ?? 'pending',
    datumBenchmark: existing?.datumBenchmark ?? '',
    datumEntranceAltitude: existing?.datumEntranceAltitude ?? null,
    datumNote: existing?.datumNote ?? '新洞段尚未对账，挂待核',
    datumConfirmedAt: existing?.datumConfirmedAt ?? null,
    resultAltitude: existing?.resultAltitude ?? null
  }
  await segmentStore.getState().save(segment)
  dialogVisible.value = false
  ElMessage.success(existing ? '洞段已更新' : '洞段已建立，已挂待核等待对账')
}

async function applyBatchType(): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要调整的洞段')
    return
  }
  await segmentStore.getState().bulkSetType(selectedIds.value, batchType.value)
  ElMessage.success(`已把 ${selectedIds.value.length} 个洞段调整为「${batchType.value}」`)
}

async function applyBatchClosed(closed: boolean): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要调整的洞段')
    return
  }
  await segmentStore.getState().bulkSetClosed(selectedIds.value, closed)
  ElMessage.success(closed ? '已标记为闭合' : '已取消闭合标记')
}

/** 对账失败后只重试这一个洞段（已认基准的洞段不会走到这里） */
async function retryOne(segment: Segment): Promise<void> {
  const next = await segmentStore.getState().recompute(segment.id)
  if (!next) return
  if (next.datumStatus === 'confirmed') {
    ElMessage.success(`洞段 ${next.code} 高程重算完成，已按新基准认过`)
  } else {
    ElMessage.warning(`洞段 ${next.code} 重试后仍对不上，继续挂待核：${next.datumNote}`)
  }
}

/** 批量对账：只重试待高程重算 / 待核洞段，已认基准洞段不回退 */
async function runReconcile(ids?: string[]): Promise<void> {
  const report = await segmentStore.getState().reconcile(ids)
  if (report.retried === 0) {
    ElMessage.info('没有需要重试的洞段（已认基准洞段不参与，待确认回填洞段请先补洞口海拔）')
    return
  }
  if (report.confirmed > 0) ElMessage.success(`对账完成：${report.confirmed} 段已按新基准认过`)
  if (report.pendingIds.length > 0) {
    ElMessage.warning(`${report.pendingIds.length} 段接测高差与累计垂距仍对不上，挂账待核（基准归属等登记室结论）`)
  }
  if (report.unbackfilledIds.length > 0) {
    ElMessage.warning(`${report.unbackfilledIds.length} 段回填不上洞口海拔，已单列等待确认`)
  }
}

function openBackfill(segment: Segment): void {
  backfillTarget.value = segment
  backfillAltitude.value = caveOf(segment.caveId)?.altitude ?? 0
}

async function submitBackfill(): Promise<void> {
  const target = backfillTarget.value
  if (!target) return
  if (!(backfillAltitude.value > 0) || !Number.isFinite(backfillAltitude.value)) {
    ElMessage.warning('请填写有效的洞口海拔')
    return
  }
  const next = await segmentStore.getState().confirmBackfill(target.id, Number(backfillAltitude.value))
  backfillTarget.value = null
  if (!next) return
  if (next.datumStatus === 'confirmed') ElMessage.success(`洞段 ${next.code} 已按确认海拔补基准并认过`)
  else ElMessage.warning(`洞段 ${next.code} 海拔已补，但高差仍对不上，继续挂待核`)
}

async function removeSegment(segment: Segment): Promise<void> {
  const count = stationCount(segment.id)
  if (count > 0) {
    ElMessage.error(`洞段「${segment.code}」下仍有 ${count} 个测点，请先清理`)
    return
  }
  await ElMessageBox.confirm(`确认删除洞段「${segment.code}」？`, '删除确认', { type: 'warning' })
  await segmentStore.getState().remove(segment.id)
  ElMessage.success('洞段已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">洞段编目表</h2>
        <p class="page-sub">
          按桩号区间筛选洞段、批量调整洞段类型；洞段长度由起止桩号自动计算，并累计为洞穴实测总长。
        </p>
      </div>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>新建洞段
      </el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="filterCaveId" placeholder="全部洞穴" clearable style="width: 200px">
        <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 140px">
        <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <el-select v-model="filterDatum" placeholder="全部基准状态" clearable style="width: 160px">
        <el-option
          v-for="status in DATUM_STATUS_ORDER"
          :key="status"
          :label="DATUM_STATUS_LABELS[status]"
          :value="status"
        />
      </el-select>
      <div class="range">
        <span class="muted">桩号区间筛选（米）</span>
        <el-input-number v-model="rangeStart" :min="0" :controls="false" placeholder="起" style="width: 110px" />
        <span>—</span>
        <el-input-number v-model="rangeEnd" :min="0" :controls="false" placeholder="止" style="width: 110px" />
      </div>
      <el-select v-model="batchType" style="width: 140px">
        <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <el-button type="primary" plain @click="applyBatchType">批量调整类型</el-button>
      <el-button @click="applyBatchClosed(true)">标记闭合</el-button>
      <el-button @click="applyBatchClosed(false)">取消闭合</el-button>
      <el-tag type="info" effect="plain">命中共 {{ filtered.length }} 段 · 合计 {{ totalLength }} m</el-tag>
    </div>

    <el-alert
      class="reconcile-bar"
      :closable="false"
      show-icon
      type="warning"
      title="洞口台账与洞内成果对账"
      description="按洞口点名逐段核对登记室接测高差与测量小组累计垂距；对账失败只重试该洞段，已按新基准认过的洞段不跟着回退。"
    >
      <template #default>
        <div class="reconcile-line">
          <DatumTag status="confirmed" :count="datumSummary.confirmed" size="default" />
          <DatumTag status="stale" :count="datumSummary.stale" size="default" />
          <DatumTag status="pending" :count="datumSummary.pending" size="default" />
          <DatumTag status="unbackfilled" :count="datumSummary.unbackfilled" size="default" />
          <span class="muted">对账容差 ±{{ DATUM_TOLERANCE }} m</span>
          <el-button
            type="warning"
            plain
            :disabled="datumSummary.stale + datumSummary.pending === 0"
            @click="runReconcile()"
          >
            全量对账（只重试待重算 / 待核段）
          </el-button>
        </div>
      </template>
    </el-alert>

    <el-table
      :data="filtered"
      border
      stripe
      row-key="id"
      @selection-change="(rows: Segment[]) => (selectedIds = rows.map((row) => row.id))"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="洞段" width="120">
        <template #default="{ row }: { row: Segment }">
          <span class="mono">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column label="归属洞穴" min-width="150">
        <template #default="{ row }: { row: Segment }">{{ caveName(row.caveId) }}</template>
      </el-table-column>
      <el-table-column label="洞口点名" width="110">
        <template #default="{ row }: { row: Segment }">
          <span class="mono">{{ row.entranceCode || '未认领' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="170">
        <template #default="{ row }: { row: Segment }">
          <SegmentTag :type="row.type" :closed="row.closed" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="桩号区间" min-width="200">
        <template #default="{ row }: { row: Segment }">
          <span class="mono">{{ row.startStake }} → {{ row.endStake }}</span>
          <div class="muted">长度 {{ segmentLength(row) }} m</div>
        </template>
      </el-table-column>
      <el-table-column label="平均宽×高(m)" width="140">
        <template #default="{ row }: { row: Segment }">{{ row.avgWidth }} × {{ row.avgHeight }}</template>
      </el-table-column>
      <el-table-column prop="slopeTrend" label="坡度趋势" width="120" />
      <el-table-column label="测点数" width="90">
        <template #default="{ row }: { row: Segment }">{{ stationCount(row.id) }}</template>
      </el-table-column>
      <el-table-column label="基准对账" width="230">
        <template #default="{ row }: { row: Segment }">
          <DatumTag :status="row.datumStatus" />
          <div class="datum-line">
            <span class="muted">接测高差：</span>
            <b :class="{ mismatch: verticalDelta(row) !== null && Math.abs(verticalDelta(row) as number) > DATUM_TOLERANCE }">
              {{ registryDelta(row) === null ? '—' : `${registryDelta(row)} m` }}
            </b>
          </div>
          <div class="datum-line">
            <span class="muted">累计垂距：</span>
            <b>{{ liveVertical(row) === null ? '—' : `${liveVertical(row)} m` }}</b>
          </div>
          <div v-if="row.datumNote" class="datum-note">{{ row.datumNote }}</div>
          <div v-if="row.datumStatus === 'confirmed' && row.resultAltitude !== null" class="datum-line">
            <span class="muted">洞段成果高程：</span>
            <b>{{ row.resultAltitude }} m</b>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="sketchNo" label="草图序号" width="100" />
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }: { row: Segment }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button
            v-if="row.datumStatus === 'stale' || row.datumStatus === 'pending'"
            link
            type="warning"
            size="small"
            @click="retryOne(row)"
          >
            {{ row.datumStatus === 'stale' ? '重算' : '重试对账' }}
          </el-button>
          <el-button
            v-if="row.datumStatus === 'unbackfilled'"
            link
            type="warning"
            size="small"
            @click="openBackfill(row)"
          >
            补海拔确认
          </el-button>
          <el-button link type="danger" size="small" @click="removeSegment(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑洞段' : '新建洞段'" width="620px">
      <el-form label-width="110px">
        <el-form-item label="归属洞穴" required>
          <el-select v-model="form.caveId" style="width: 100%" @change="syncEntranceFromCave">
            <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="洞口点名" required>
              <el-input v-model="form.entranceCode" placeholder="如 RK-01，按此点名与登记室对账" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="登记室接测高差(m)">
              <el-input-number
                v-model="form.datumLevelDelta"
                :precision="3"
                :controls="false"
                style="width: 100%"
              />
              <div class="muted">留空表示水准点结论未给，对账时该段挂待核</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="洞段编号" required>
              <el-input v-model="form.code" placeholder="如 C-03" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="洞段类型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="起始桩号">
              <el-input v-model="form.startStake" placeholder="K0+000" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束桩号">
              <el-input v-model="form.endStake" placeholder="K0+050" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="平均宽(m)">
              <el-input-number v-model="form.avgWidth" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="平均高(m)">
              <el-input-number v-model="form.avgHeight" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="坡度趋势">
          <el-input v-model="form.slopeTrend" placeholder="如 缓升 3°" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="草图序号">
              <el-input v-model="form.sketchNo" placeholder="如 S-03" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否已闭合">
              <el-switch v-model="form.closed" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="backfillTarget" title="旧洞段补洞口海拔确认" width="480px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`洞段 ${backfillTarget?.code ?? ''} 在旧数据升级时回填不上接测基准，需要登记室确认当时洞口海拔。`"
        style="margin-bottom: 12px"
      />
      <el-form label-width="130px">
        <el-form-item label="洞口点名">
          <span class="mono">{{ backfillTarget?.entranceCode || '未认领' }}</span>
        </el-form-item>
        <el-form-item label="确认洞口海拔(m)" required>
          <el-input-number v-model="backfillAltitude" :precision="3" :controls="false" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="backfillTarget = null">取消</el-button>
        <el-button type="primary" @click="submitBackfill">确认并对这一段重试</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.range {
  display: flex;
  align-items: center;
  gap: 6px;
}
.reconcile-bar {
  margin: 12px 0;
}
.reconcile-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.datum-line {
  font-size: 12px;
  line-height: 1.7;
}
.datum-note {
  font-size: 11px;
  color: #97a5b3;
  line-height: 1.5;
}
.mismatch {
  color: #c0392b;
}
</style>
