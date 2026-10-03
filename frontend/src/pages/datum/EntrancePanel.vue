<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Entrance } from '@/types'
import { BENCHMARK_CONCLUSION_META } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { datumStore } from '@/stores/datumStore'

const caveState = useStore(caveStore)
const datumState = useStore(datumStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  caveId: '',
  name: '',
  longitude: 0,
  latitude: 0,
  altitude: 0,
  benchmarkId: '',
  connectionHeightDiff: null as number | null
})

const benchmarkName = (id: string): string => datumState.benchmarks.find((item) => item.id === id)?.name ?? '—'
const benchmarkMeta = (id: string) => {
  const bm = datumState.benchmarks.find((item) => item.id === id)
  return bm ? BENCHMARK_CONCLUSION_META[bm.conclusion] : null
}
const caveName = (caveId: string): string => caveState.caves.find((cave) => cave.id === caveId)?.name ?? '未归属洞穴'

const referencedEntranceNames = computed(() => {
  const map = new Map<string, number>()
  for (const item of datumState.elevations) {
    if (item.status !== 'unconfirmed') map.set(item.entranceName, (map.get(item.entranceName) ?? 0) + 1)
  }
  return map
})

/** 该洞口下挂着的已认基准洞段成果数，保存改基准时会被挑出重算 */
function staleCount(name: string, datumVersion: number): number {
  return datumState.elevations.filter(
    (item) =>
      item.status === 'confirmed' &&
      item.entranceName === name &&
      (item.datumSnapshot?.datumVersion ?? 0) <= datumVersion
  ).length
}

function resetForm(): void {
  editingId.value = null
  form.caveId = caveState.caves[0]?.id ?? ''
  form.name = ''
  form.longitude = 0
  form.latitude = 0
  form.altitude = 0
  form.benchmarkId = ''
  form.connectionHeightDiff = null
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: Entrance): void {
  editingId.value = row.id
  form.caveId = row.caveId
  form.name = row.name
  form.longitude = row.longitude
  form.latitude = row.latitude
  form.altitude = row.altitude
  form.benchmarkId = row.benchmarkId
  form.connectionHeightDiff = row.connectionHeightDiff
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.caveId) {
    ElMessage.warning('请选择归属洞穴')
    return
  }
  if (!form.name.trim()) {
    ElMessage.warning('请填写洞口点名，它是两摊对账的唯一键')
    return
  }
  const duplicated = datumState.entrances.some(
    (item) => item.name === form.name.trim() && item.id !== editingId.value
  )
  if (duplicated) {
    ElMessage.warning('洞口点名重复，两摊会对错账')
    return
  }
  const editing = editingId.value ? datumState.entrances.find((item) => item.id === editingId.value) : undefined
  const datumChanged =
    editing !== undefined &&
    (editing.altitude !== Number(form.altitude) ||
      editing.benchmarkId !== form.benchmarkId ||
      editing.connectionHeightDiff !== form.connectionHeightDiff)
  if (datumChanged && editing) {
    const count = staleCount(editing.name, editing.datumVersion)
    await ElMessageBox.confirm(
      `洞口海拔 / 接测点 / 接测高差已改动，基准将升到新版本，该洞口下 ${count} 个已认基准的洞段成果会被挑出等待高程重算（现场读数不动）。是否继续？`,
      '基准变更确认',
      { type: 'warning', confirmButtonText: '改基准并挑出重算', cancelButtonText: '再看看' }
    )
  }
  const { bumped } = await datumStore.getState().saveEntrance({
    id: editingId.value ?? undefined,
    caveId: form.caveId,
    name: form.name,
    longitude: Number(form.longitude) || 0,
    latitude: Number(form.latitude) || 0,
    altitude: Number(form.altitude) || 0,
    benchmarkId: form.benchmarkId,
    connectionHeightDiff: form.connectionHeightDiff
  })
  dialogVisible.value = false
  ElMessage.success(bumped ? '洞口资料已更新，旧基准成果已挑出待重算' : editingId.value ? '洞口资料已更新' : '洞口已登记')
}

async function remove(row: Entrance): Promise<void> {
  const count = referencedEntranceNames.value.get(row.name) ?? 0
  if (count > 0) {
    ElMessage.error(`洞口「${row.name}」仍有 ${count} 条洞段成果在对账，请先处理测量组成果`)
    return
  }
  await ElMessageBox.confirm(`确认删除洞口「${row.name}」的登记资料？`, '删除确认', { type: 'warning' })
  await datumStore.getState().removeEntrance(row.id)
  ElMessage.success('洞口资料已删除')
}
</script>

<template>
  <div>
    <div class="panel-head">
      <p class="panel-tip">
        普查登记室保管洞口点名、经纬度、海拔与接测水准点、接测高差。<b>改动海拔或接测点会令基准版本自增</b>，旧基准上认过的洞段成果自动挑出待重算。
      </p>
      <el-button type="primary" size="small" @click="openCreate">
        <el-icon><Plus /></el-icon>登记洞口
      </el-button>
    </div>

    <el-table :data="datumState.entrances" border stripe size="small">
      <el-table-column prop="name" label="洞口点名" width="160">
        <template #default="{ row }: { row: Entrance }">
          <span class="mono">{{ row.name }}</span>
          <el-tag class="ver-tag" size="small" effect="plain">v{{ row.datumVersion }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="归属洞穴" width="150">
        <template #default="{ row }: { row: Entrance }">{{ caveName(row.caveId) }}</template>
      </el-table-column>
      <el-table-column label="经度 / 纬度" width="170">
        <template #default="{ row }: { row: Entrance }">
          {{ row.longitude.toFixed(4) }}, {{ row.latitude.toFixed(4) }}
        </template>
      </el-table-column>
      <el-table-column prop="altitude" label="海拔(m)" width="100" />
      <el-table-column label="接测水准点" min-width="180">
        <template #default="{ row }: { row: Entrance }">
          <template v-if="row.benchmarkId">
            <span class="mono">{{ benchmarkName(row.benchmarkId) }}</span>
            <el-tag
              v-if="benchmarkMeta(row.benchmarkId)"
              :type="benchmarkMeta(row.benchmarkId)?.type"
              size="small"
              effect="plain"
              class="ver-tag"
            >
              {{ benchmarkMeta(row.benchmarkId)?.label }}
            </el-tag>
          </template>
          <span v-else class="muted">未接测</span>
        </template>
      </el-table-column>
      <el-table-column label="接测高差(m)" width="120">
        <template #default="{ row }: { row: Entrance }">
          <span v-if="row.connectionHeightDiff !== null">{{ row.connectionHeightDiff }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }: { row: Entrance }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无洞口资料，先由登记室登记一个洞口</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑洞口资料' : '登记洞口'" width="600px">
      <el-form label-width="110px">
        <el-form-item label="归属洞穴" required>
          <el-select v-model="form.caveId" style="width: 100%">
            <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="洞口点名" required>
          <el-input v-model="form.name" placeholder="如 青龙洞·东入口（两摊按此点名对账）" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="经度">
              <el-input-number v-model="form.longitude" :precision="4" :step="0.0001" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="纬度">
              <el-input-number v-model="form.latitude" :precision="4" :step="0.0001" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="洞口海拔(m)" required>
              <el-input-number v-model="form.altitude" :precision="3" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="接测高差(m)">
              <el-input-number
                v-model="form.connectionHeightDiff"
                :precision="3"
                :controls="false"
                placeholder="可暂不登记"
                style="width: 100%"
                :value-on-clear="null"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="接测水准点">
          <el-select v-model="form.benchmarkId" clearable placeholder="暂未接测（洞段成果将挂待核）" style="width: 100%">
            <el-option
              v-for="bm in datumState.benchmarks"
              :key="bm.id"
              :label="`${bm.name}（${BENCHMARK_CONCLUSION_META[bm.conclusion].label}）`"
              :value="bm.id"
            />
          </el-select>
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
  max-width: 780px;
}
.ver-tag {
  margin-left: 6px;
}
</style>
