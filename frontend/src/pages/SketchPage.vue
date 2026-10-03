<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Sketch, Station } from '@/types'
import BearingInput from '@/components/common/BearingInput.vue'
import GridCanvas from '@/components/common/GridCanvas.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { sketchStore } from '@/stores/sketchStore'
import { toRadians } from '@/utils/survey'
import { uid } from '@/utils/id'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)
const sketchState = useStore(sketchStore)

const CANVAS_W = 760
const CANVAS_H = 440
const PAD = 46

const selectedCaveId = ref<string>(caveState.caves[0]?.id ?? '')
const selectedSegmentId = ref<string>('')
const editingId = ref<string | null>(null)
/** 草图朝向基准方位角：把洞段整体旋转到图纸正上方为前进方向 */
const baseBearing = ref(0)

const form = reactive({
  code: '',
  gridCount: 40,
  scale: 200,
  author: '',
  mergeOrder: 1,
  anchorStake: 'K0+000',
  imageNote: ''
})

const segmentOptions = computed(() =>
  segmentState.segments.filter((segment) => !selectedCaveId.value || segment.caveId === selectedCaveId.value)
)
const currentSegment = computed(() => segmentState.segments.find((segment) => segment.id === selectedSegmentId.value))

// IndexedDB 异步水合完成后自动选中第一条洞穴 / 洞段
watch(
  () => [caveState.caves.length, selectedCaveId.value] as const,
  () => {
    if (!selectedCaveId.value && caveState.caves.length > 0) {
      selectedCaveId.value = caveState.caves[0].id
    }
  },
  { immediate: true }
)

watch(
  () => [selectedCaveId.value, segmentOptions.value.length] as const,
  () => {
    const list = segmentOptions.value
    if (!list.some((segment) => segment.id === selectedSegmentId.value)) {
      selectedSegmentId.value = list.length > 0 ? list[0].id : ''
    }
  },
  { immediate: true }
)

const segmentStations = computed<Station[]>(() =>
  stationState.stations
    .filter((station) => station.segmentId === selectedSegmentId.value)
    .sort((a, b) => Number((a.code.match(/\d+/) ?? ['0'])[0]) - Number((b.code.match(/\d+/) ?? ['0'])[0]))
)

/** 测点折线：以起点为原点，按方位角/水平距投影到平面坐标 */
interface PlotPoint {
  station: Station
  x: number
  y: number
}

const rawPoints = computed<{ x: number; y: number; station: Station }[]>(() => {
  const points: { x: number; y: number; station: Station }[] = []
  let east = 0
  let north = 0
  for (const station of segmentStations.value) {
    const bearing = toRadians(station.bearing - baseBearing.value)
    east += station.horizontalDistance * Math.sin(bearing)
    north += station.horizontalDistance * Math.cos(bearing)
    points.push({ x: east, y: north, station })
  }
  return points
})

const plotScale = computed(() => {
  const xs = rawPoints.value.map((p) => Math.abs(p.x))
  const ys = rawPoints.value.map((p) => Math.abs(p.y))
  const maxExtent = Math.max(1, ...xs, ...ys)
  return Math.min((CANVAS_W - PAD * 2) / maxExtent, (CANVAS_H - PAD * 2) / maxExtent)
})

const plotPoints = computed<PlotPoint[]>(() =>
  rawPoints.value.map((point) => ({
    station: point.station,
    x: PAD + point.x * plotScale.value,
    y: CANVAS_H - PAD - point.y * plotScale.value
  }))
)

const polyline = computed(() => plotPoints.value.map((point) => `${point.x},${point.y}`).join(' '))

function dipArrow(point: PlotPoint, index: number): { x2: number; y2: number } {
  const length = 18 + Math.abs(point.station.dip)
  const rad = toRadians(point.station.bearing)
  const dir = point.station.dip >= 0 ? -1 : 1
  return {
    x2: point.x + Math.cos(rad) * length,
    y2: point.y + Math.sin(rad) * length * dir + (index % 2 === 0 ? 0 : 6)
  }
}

function resetForm(): void {
  editingId.value = null
  form.code = `S-${String(sketchState.sketches.length + 1).padStart(2, '0')}`
  form.gridCount = 40
  form.scale = 200
  form.author = caveState.caves.find((cave) => cave.id === selectedCaveId.value)?.surveyor ?? ''
  form.mergeOrder = sketchState.sketches.length + 1
  form.anchorStake = currentSegment.value?.startStake ?? 'K0+000'
  form.imageNote = ''
}

watch(() => selectedSegmentId.value, resetForm, { immediate: true })

const segmentSketches = computed(() =>
  sketchState.sketches
    .filter((sketch) => sketch.segmentId === selectedSegmentId.value)
    .sort((a, b) => a.mergeOrder - b.mergeOrder)
)

async function submit(): Promise<void> {
  if (!selectedSegmentId.value) {
    ElMessage.warning('请先选择洞段')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写草图编号')
    return
  }
  const existing = sketchState.sketches.find((item) => item.id === editingId.value)
  const sketch: Sketch = {
    id: existing?.id ?? uid('sk'),
    segmentId: selectedSegmentId.value,
    code: form.code.trim(),
    gridCount: Number(form.gridCount) || 0,
    scale: Number(form.scale) || 100,
    author: form.author.trim(),
    mergeOrder: Number(form.mergeOrder) || 1,
    anchorStake: form.anchorStake.trim(),
    imageNote: form.imageNote.trim()
  }
  await sketchStore.getState().save(sketch)
  ElMessage.success(existing ? '草图记录已更新' : '草图记录已建立')
  resetForm()
}

function editSketch(sketch: Sketch): void {
  editingId.value = sketch.id
  form.code = sketch.code
  form.gridCount = sketch.gridCount
  form.scale = sketch.scale
  form.author = sketch.author
  form.mergeOrder = sketch.mergeOrder
  form.anchorStake = sketch.anchorStake
  form.imageNote = sketch.imageNote
}

async function removeSketch(sketch: Sketch): Promise<void> {
  await ElMessageBox.confirm(`确认删除草图「${sketch.code}」？`, '删除确认', { type: 'warning' })
  await sketchStore.getState().remove(sketch.id)
  ElMessage.success('草图记录已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">草图工作台</h2>
        <p class="page-sub">
          在坐标纸网格上按测点折线绘制洞段平面草图，标注测点桩号与倾角箭头；网格比例与草图记录一一对应。
        </p>
      </div>
      <el-tag type="info" effect="plain">当前比例 1 : {{ form.scale }}</el-tag>
    </div>

    <div class="toolbar">
      <el-select v-model="selectedCaveId" placeholder="选择洞穴" style="width: 200px">
        <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="selectedSegmentId" placeholder="选择洞段" style="width: 220px">
        <el-option v-for="segment in segmentOptions" :key="segment.id" :label="segment.code" :value="segment.id" />
      </el-select>
      <el-tag effect="plain">测点 {{ segmentStations.length }} 个</el-tag>
      <el-tag effect="plain">草图 {{ segmentSketches.length }} 张</el-tag>
      <div class="base-bearing">
        <BearingInput v-model="baseBearing" kind="bearing" label="草图基准方位" @invalid="(msg: string) => ElMessage.warning(msg)" />
      </div>
    </div>

    <div class="canvas-row">
      <GridCanvas
        :width="CANVAS_W"
        :height="CANVAS_H"
        :grid-size="20"
        :meters-per-grid="1"
        title="洞段平面草图（坐标纸网格）"
      >
        <g v-if="plotPoints.length > 1">
          <polyline :points="polyline" fill="none" stroke="#2f6f8f" stroke-width="2.5" stroke-linejoin="round" />
        </g>
        <g v-for="(point, index) in plotPoints" :key="point.station.id">
          <circle :cx="point.x" :cy="point.y" r="4.5" fill="#1f3a4d" />
          <line
            :x1="point.x"
            :y1="point.y"
            :x2="dipArrow(point, index).x2"
            :y2="dipArrow(point, index).y2"
            stroke="#c98a1b"
            stroke-width="1.6"
            marker-end="url(#dipArrowHead)"
          />
          <text :x="point.x + 7" :y="point.y - 7" font-size="11" fill="#35506b">
            {{ point.station.code }} · {{ point.station.dip }}°
          </text>
        </g>
        <text :x="PAD - 30" :y="CANVAS_H - 12" font-size="11" fill="#8a97a3">
          起点 K0
        </text>
        <text v-if="plotPoints.length === 0" :x="CANVAS_W / 2 - 90" :y="CANVAS_H / 2" font-size="13" fill="#8a97a3">
          该洞段暂无测点，请先到「测点读数」录入
        </text>
        <defs>
          <marker id="dipArrowHead" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="#c98a1b" />
          </marker>
        </defs>
        <template #legend>
          <span>● 测点</span>
          <span>▸ 倾角方向</span>
          <span>深色线 = 5 格</span>
          <span>1 格 = 1 m</span>
        </template>
      </GridCanvas>

      <el-card shadow="never" class="sketch-form">
        <template #header>{{ editingId ? '编辑草图记录' : '新建草图记录' }}</template>
        <el-form label-width="90px" size="small">
          <el-form-item label="草图编号" required>
            <el-input v-model="form.code" placeholder="如 S-03" />
          </el-form-item>
          <el-form-item label="坐标纸格数">
            <el-input-number v-model="form.gridCount" :min="1" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="缩放比例">
            <el-input-number v-model="form.scale" :min="10" :step="10" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="绘制人">
            <el-input v-model="form.author" />
          </el-form-item>
          <el-form-item label="拼合顺序">
            <el-input-number v-model="form.mergeOrder" :min="1" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="锚点桩号">
            <el-input v-model="form.anchorStake" placeholder="如 K0+120" />
          </el-form-item>
          <el-form-item label="图片说明">
            <el-input v-model="form.imageNote" type="textarea" :rows="2" placeholder="草图内容与左壁/右壁标注说明" />
          </el-form-item>
          <div class="form-actions">
            <el-button type="primary" size="small" @click="submit">保存</el-button>
            <el-button v-if="editingId" size="small" @click="resetForm">取消</el-button>
          </div>
        </el-form>
      </el-card>
    </div>

    <h3 class="section-title">该洞段草图清单</h3>
    <el-table :data="segmentSketches" border stripe>
      <el-table-column prop="mergeOrder" label="拼合顺序" width="100" />
      <el-table-column prop="code" label="草图编号" width="110" />
      <el-table-column prop="gridCount" label="格数" width="90" />
      <el-table-column label="比例" width="110">
        <template #default="{ row }: { row: Sketch }">1 : {{ row.scale }}</template>
      </el-table-column>
      <el-table-column prop="author" label="绘制人" width="100" />
      <el-table-column prop="anchorStake" label="锚点桩号" width="130" />
      <el-table-column prop="imageNote" label="图片数据说明" min-width="200" show-overflow-tooltip />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }: { row: Sketch }">
          <el-button link type="primary" size="small" @click="editSketch(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="removeSketch(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.base-bearing {
  width: 240px;
}
.canvas-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
}
.sketch-form {
  width: 320px;
  border-radius: 12px;
}
.form-actions {
  display: flex;
  gap: 8px;
  padding-left: 90px;
}
</style>
