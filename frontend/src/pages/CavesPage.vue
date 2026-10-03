<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Cave } from '@/types'
import { segmentLength } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { uid } from '@/utils/id'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)

const showArchived = ref(false)
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  region: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
  layer: '',
  knownLength: 0,
  startDate: new Date().toISOString().slice(0, 10),
  surveyor: '',
  climateNote: ''
})

const visibleCaves = computed(() =>
  caveState.caves.filter((cave) => (showArchived.value ? true : !cave.archived))
)

function segmentsOf(caveId: string): typeof segmentState.segments {
  return segmentState.segments.filter((item) => item.caveId === caveId)
}

function totalLength(caveId: string): number {
  return Math.round(segmentsOf(caveId).reduce((sum, item) => sum + segmentLength(item), 0) * 10) / 10
}

function lastSurveyDate(caveId: string): string {
  const segmentIds = segmentsOf(caveId).map((item) => item.id)
  const dates = stationState.stations
    .filter((station) => segmentIds.includes(station.segmentId))
    .map((station) => station.date)
    .filter(Boolean)
  if (dates.length === 0) return '暂无测点'
  return dates.sort()[dates.length - 1]
}

function resetForm(): void {
  form.name = ''
  form.region = ''
  form.longitude = 0
  form.latitude = 0
  form.altitude = 0
  form.layer = ''
  form.knownLength = 0
  form.startDate = new Date().toISOString().slice(0, 10)
  form.surveyor = ''
  form.climateNote = ''
  editingId.value = null
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(cave: Cave): void {
  editingId.value = cave.id
  form.name = cave.name
  form.region = cave.region
  form.longitude = cave.longitude
  form.latitude = cave.latitude
  form.altitude = cave.altitude
  form.layer = cave.layer
  form.knownLength = cave.knownLength
  form.startDate = cave.startDate
  form.surveyor = cave.surveyor
  form.climateNote = cave.climateNote
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请填写洞穴名')
    return
  }
  const existing = caveState.caves.find((item) => item.id === editingId.value)
  const cave: Cave = {
    id: existing?.id ?? uid('cave'),
    name: form.name.trim(),
    region: form.region.trim(),
    longitude: Number(form.longitude) || 0,
    latitude: Number(form.latitude) || 0,
    altitude: Number(form.altitude) || 0,
    layer: form.layer.trim(),
    knownLength: Number(form.knownLength) || 0,
    startDate: form.startDate,
    surveyor: form.surveyor.trim(),
    climateNote: form.climateNote.trim(),
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? new Date().toISOString()
  }
  await caveStore.getState().save(cave)
  dialogVisible.value = false
  ElMessage.success(existing ? '洞穴信息已更新' : '洞穴已建立')
}

async function toggleArchive(cave: Cave): Promise<void> {
  await caveStore.getState().setArchived(cave.id, !cave.archived)
  ElMessage.success(cave.archived ? '已取消归档' : '已归档')
}

async function removeCave(cave: Cave): Promise<void> {
  const childCount = segmentsOf(cave.id).length
  if (childCount > 0) {
    ElMessage.error(`「${cave.name}」下仍有 ${childCount} 个洞段，请先清理下级记录`)
    return
  }
  await ElMessageBox.confirm(`确认删除洞穴「${cave.name}」？`, '删除确认', { type: 'warning' })
  await caveStore.getState().remove(cave.id)
  ElMessage.success('洞穴已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">洞穴清单</h2>
        <p class="page-sub">
          以洞穴为归属根节点，汇总洞段总长、洞段数量与最近测量日期；删除前会校验下级记录数。
        </p>
      </div>
      <div>
        <el-switch v-model="showArchived" active-text="显示已归档" style="margin-right: 12px" />
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建洞穴
        </el-button>
      </div>
    </div>

    <div class="card-grid">
      <el-card v-for="cave in visibleCaves" :key="cave.id" shadow="hover" class="cave-card">
        <div class="card-top">
          <div>
            <div class="cave-name">{{ cave.name }}</div>
            <div class="muted">{{ cave.region || '未填行政区' }}</div>
          </div>
          <el-tag :type="cave.archived ? 'info' : 'success'" effect="plain" size="small">
            {{ cave.archived ? '已归档' : '在测' }}
          </el-tag>
        </div>
        <div class="metrics">
          <div class="metric">
            <span>实测总长</span>
            <b>{{ totalLength(cave.id) }} m</b>
          </div>
          <div class="metric">
            <span>已知总长</span>
            <b>{{ cave.knownLength }} m</b>
          </div>
          <div class="metric">
            <span>洞段数</span>
            <b>{{ segmentsOf(cave.id).length }}</b>
          </div>
          <div class="metric">
            <span>最近测量</span>
            <b>{{ lastSurveyDate(cave.id) }}</b>
          </div>
        </div>
        <el-descriptions :column="1" size="small" border class="desc">
          <el-descriptions-item label="经纬度">
            {{ cave.longitude.toFixed(4) }}, {{ cave.latitude.toFixed(4) }}
          </el-descriptions-item>
          <el-descriptions-item label="海拔">{{ cave.altitude }} m</el-descriptions-item>
          <el-descriptions-item label="发育层位">{{ cave.layer || '—' }}</el-descriptions-item>
          <el-descriptions-item label="测绘负责人">{{ cave.surveyor || '—' }}</el-descriptions-item>
          <el-descriptions-item label="洞内温湿度">{{ cave.climateNote || '—' }}</el-descriptions-item>
          <el-descriptions-item label="测量起始日期">{{ cave.startDate }}</el-descriptions-item>
        </el-descriptions>
        <div class="card-actions">
          <el-button size="small" @click="openEdit(cave)">编辑</el-button>
          <el-button size="small" @click="toggleArchive(cave)">
            {{ cave.archived ? '取消归档' : '归档' }}
          </el-button>
          <el-button size="small" type="danger" plain @click="removeCave(cave)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="visibleCaves.length === 0" description="暂无洞穴，先新建一个洞穴" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑洞穴' : '新建洞穴'" width="640px">
      <el-form label-width="110px">
        <el-form-item label="洞穴名" required>
          <el-input v-model="form.name" placeholder="如 青龙背斜溶洞" />
        </el-form-item>
        <el-form-item label="行政区">
          <el-input v-model="form.region" placeholder="如 黔南州 · 平塘县" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="经度">
              <el-input-number v-model="form.longitude" :precision="4" :step="0.0001" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="纬度">
              <el-input-number v-model="form.latitude" :precision="4" :step="0.0001" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="海拔(m)">
              <el-input-number v-model="form.altitude" :precision="1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="发育层位">
          <el-input v-model="form.layer" placeholder="如 二叠系下统栖霞组灰岩" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="已知总长(m)">
              <el-input-number v-model="form.knownLength" :min="0" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="起始日期">
              <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="测绘负责人">
          <el-input v-model="form.surveyor" placeholder="如 陆昀" />
        </el-form-item>
        <el-form-item label="温湿度备注">
          <el-input v-model="form.climateNote" type="textarea" :rows="2" placeholder="洞内温度、湿度、滴水等情况" />
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
.cave-card {
  border-radius: 12px;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.cave-name {
  font-size: 16px;
  font-weight: 600;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 12px 0;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f8fb;
  font-size: 12px;
  color: #6b7b8c;
}
.metric b {
  font-size: 14px;
  color: #1f3a4d;
}
.desc {
  margin-bottom: 12px;
}
.card-actions {
  display: flex;
  gap: 8px;
}
</style>
