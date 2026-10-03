<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Benchmark, BenchmarkConclusion } from '@/types'
import { BENCHMARK_CONCLUSIONS, BENCHMARK_CONCLUSION_META } from '@/types'
import { useStore } from '@/hooks/usePersistentStore'
import { datumStore } from '@/stores/datumStore'

const datumState = useStore(datumStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  grade: '',
  elevation: 0,
  conclusion: 'established' as BenchmarkConclusion,
  note: ''
})

const referencedBenchmarkIds = computed(() => new Set(datumState.entrances.map((item) => item.benchmarkId).filter(Boolean)))

function resetForm(): void {
  editingId.value = null
  form.name = ''
  form.grade = ''
  form.elevation = 0
  form.conclusion = 'established'
  form.note = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: Benchmark): void {
  editingId.value = row.id
  form.name = row.name
  form.grade = row.grade
  form.elevation = row.elevation
  form.conclusion = row.conclusion
  form.note = row.note
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请填写水准点点名')
    return
  }
  if (!Number.isFinite(Number(form.elevation))) {
    ElMessage.warning('请填写水准点高程')
    return
  }
  const duplicated = datumState.benchmarks.some(
    (item) => item.name === form.name.trim() && item.id !== editingId.value
  )
  if (duplicated) {
    ElMessage.warning('水准点点名重复，请换一个')
    return
  }
  await datumStore.getState().saveBenchmark({
    id: editingId.value ?? undefined,
    name: form.name,
    grade: form.grade,
    elevation: Number(form.elevation),
    conclusion: form.conclusion,
    note: form.note
  })
  dialogVisible.value = false
  ElMessage.success(editingId.value ? '水准点结论已更新' : '水准点已登记')
}

async function remove(row: Benchmark): Promise<void> {
  if (referencedBenchmarkIds.value.has(row.id)) {
    ElMessage.error(`水准点「${row.name}」仍被洞口接测引用，请先在洞口资料里改接点`)
    return
  }
  await ElMessageBox.confirm(`确认删除水准点「${row.name}」？`, '删除确认', { type: 'warning' })
  await datumStore.getState().removeBenchmark(row.id)
  ElMessage.success('水准点已删除')
}
</script>

<template>
  <div>
    <div class="panel-head">
      <p class="panel-tip">
        普查登记室保管：水准点点名、等级、高程与认定结论。<b>结论未定的水准点不得作为洞段基准归属</b>，已注销的会把接它的洞段成果打回重算。
      </p>
      <el-button type="primary" size="small" @click="openCreate">
        <el-icon><Plus /></el-icon>登记水准点
      </el-button>
    </div>

    <el-table :data="datumState.benchmarks" border stripe size="small">
      <el-table-column prop="name" label="水准点点名" width="170">
        <template #default="{ row }: { row: Benchmark }">
          <span class="mono">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="grade" label="等级" width="110" />
      <el-table-column prop="elevation" label="高程(m)" width="110" />
      <el-table-column label="结论" width="110">
        <template #default="{ row }: { row: Benchmark }">
          <el-tag :type="BENCHMARK_CONCLUSION_META[row.conclusion].type" size="small" effect="dark">
            {{ BENCHMARK_CONCLUSION_META[row.conclusion].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" width="120">
        <template #default="{ row }: { row: Benchmark }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>暂无水准点，先由登记室登记一个</template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑水准点' : '登记水准点'" width="520px">
      <el-form label-width="110px">
        <el-form-item label="水准点点名" required>
          <el-input v-model="form.name" placeholder="如 BM-青龙-01" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="等级">
              <el-input v-model="form.grade" placeholder="如 国家四等" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="高程(m)" required>
              <el-input-number v-model="form.elevation" :precision="3" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="结论状态">
          <el-radio-group v-model="form.conclusion">
            <el-radio-button v-for="key in BENCHMARK_CONCLUSIONS" :key="key" :value="key">
              {{ BENCHMARK_CONCLUSION_META[key].label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="标石位置、复测情况等" />
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
  max-width: 760px;
}
</style>
