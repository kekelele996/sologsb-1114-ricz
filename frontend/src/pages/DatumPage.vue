<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStore } from '@/hooks/usePersistentStore'
import { datumStore } from '@/stores/datumStore'
import type { ElevationStatus } from '@/types'
import BenchmarkPanel from './datum/BenchmarkPanel.vue'
import EntrancePanel from './datum/EntrancePanel.vue'
import ElevationPanel from './datum/ElevationPanel.vue'
import UnconfirmedPanel from './datum/UnconfirmedPanel.vue'

const datumState = useStore(datumStore)
const activeTab = ref<'entrances' | 'benchmarks' | 'elevations' | 'unconfirmed'>('entrances')

const statusCount = (status: ElevationStatus): number => datumState.elevations.filter((row) => row.status === status).length

const cards = computed(() => [
  { key: 'confirmed', label: '已认基准', value: statusCount('confirmed'), tone: '#2f8f5b' },
  { key: 'pendingRecompute', label: '待重算', value: statusCount('pendingRecompute'), tone: '#c98a1b' },
  { key: 'pendingVerify', label: '待核', value: statusCount('pendingVerify'), tone: '#c0392b' },
  { key: 'unconfirmed', label: '回填待确认', value: statusCount('unconfirmed'), tone: '#b07d2b' }
])
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">高程基准对账台</h2>
        <p class="page-sub">
          洞口资料（普查登记室）与洞内成果（测量小组）两摊分管、按洞口点名对账：登记室改洞口海拔或换接测点后，旧基准洞段成果自动挑出待重算，现场读数原样保留；对账失败只重试该段，已按新基准认过的不回退。
        </p>
      </div>
    </div>

    <div class="stat-grid">
      <div v-for="card in cards" :key="card.key" class="stat-card" :style="{ borderTopColor: card.tone }">
        <b :style="{ color: card.tone }">{{ card.value }}</b>
        <span>{{ card.label }}</span>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane name="entrances">
        <template #label>
          <span><el-icon><LocationInformation /></el-icon> 洞口资料（登记室）</span>
        </template>
        <EntrancePanel v-if="activeTab === 'entrances'" />
      </el-tab-pane>
      <el-tab-pane name="benchmarks">
        <template #label>
          <span><el-icon><Flag /></el-icon> 水准点结论（登记室）</span>
        </template>
        <BenchmarkPanel v-if="activeTab === 'benchmarks'" />
      </el-tab-pane>
      <el-tab-pane name="elevations">
        <template #label>
          <span><el-icon><TrendCharts /></el-icon> 洞段成果（测量组）</span>
        </template>
        <ElevationPanel v-if="activeTab === 'elevations'" />
      </el-tab-pane>
      <el-tab-pane name="unconfirmed">
        <template #label>
          <span>
            <el-icon><Warning /></el-icon> 回填待确认
            <el-badge v-if="statusCount('unconfirmed') > 0" :value="statusCount('unconfirmed')" class="tab-badge" />
          </span>
        </template>
        <UnconfirmedPanel v-if="activeTab === 'unconfirmed'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #fff;
  border: 1px solid #e2e9f0;
  border-top: 3px solid #2f6f8f;
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.stat-card b {
  font-size: 26px;
}
.stat-card span {
  color: #6b7b8c;
  font-size: 13px;
}
.tabs {
  background: #fff;
  border: 1px solid #e2e9f0;
  border-radius: 12px;
  padding: 14px 16px 20px;
}
:deep(.el-tabs__item) {
  font-size: 14px;
}
.tab-badge {
  margin-left: 6px;
}
</style>
