<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { sketchStore } from '@/stores/sketchStore'

const route = useRoute()
const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)
const sketchState = useStore(sketchStore)

const menus = [
  { path: '/caves', label: '洞穴清单', icon: 'Files' },
  { path: '/segments', label: '洞段编目', icon: 'Guide' },
  { path: '/stations', label: '测点读数', icon: 'Aim' },
  { path: '/sketch', label: '草图工作台', icon: 'EditPen' },
  { path: '/merge', label: '图幅拼合', icon: 'Grid' }
]

const activeMenu = computed(() => menus.find((item) => route.path.startsWith(item.path))?.path ?? '/caves')

const stats = computed(() => [
  { label: '洞穴', value: caveState.caves.filter((cave) => !cave.archived).length },
  { label: '洞段', value: segmentState.segments.length },
  { label: '测点', value: stationState.stations.length },
  { label: '草图', value: sketchState.sketches.length }
])

onMounted(async () => {
  await caveStore.getState().hydrate()
  await segmentStore.getState().hydrate()
  await stationStore.getState().hydrate()
  await sketchStore.getState().hydrate()
})
</script>

<template>
  <el-container class="shell">
    <el-aside width="228px" class="aside">
      <div class="brand">
        <div class="logo">C</div>
        <div>
          <div class="brand-title">洞穴测绘草图编目台</div>
          <div class="brand-sub">Cave Survey Sketch Catalog</div>
        </div>
      </div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
      <div class="stat-box">
        <div v-for="item in stats" :key="item.label" class="stat-row">
          <span>{{ item.label }}</span>
          <b>{{ item.value }}</b>
        </div>
        <p class="stat-tip">数据保存在浏览器 IndexedDB，无需后端服务</p>
      </div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="crumb">{{ (route.meta.title as string) ?? '编目台' }}</span>
        <span class="head-tip">洞段 → 测点读数 → 草图 → 图幅拼合，全链路可回溯</span>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.shell {
  height: 100vh;
}
.aside {
  display: flex;
  flex-direction: column;
  background: #1f3a4d;
  color: #e8f1f5;
  padding: 16px 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
.logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #8fd3c7, #2f6f8f);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #10232e;
}
.brand-title {
  font-size: 14px;
  font-weight: 600;
}
.brand-sub {
  font-size: 11px;
  color: #9fb7c5;
}
.menu {
  border-right: none;
  background: transparent;
  flex: 0 0 auto;
}
:deep(.menu .el-menu-item) {
  color: #cfe0e9;
  border-radius: 8px;
  margin-bottom: 4px;
}
:deep(.menu .el-menu-item.is-active) {
  background: #2f6f8f;
  color: #fff;
}
:deep(.menu .el-menu-item:hover) {
  background: #2a4b60;
}
.stat-box {
  margin-top: auto;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 12px;
}
.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  color: #cfe0e9;
}
.stat-tip {
  margin: 8px 0 0;
  color: #8ea7b6;
  line-height: 1.6;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #e2e9f0;
}
.crumb {
  font-weight: 600;
}
.head-tip {
  font-size: 12px;
  color: #7a8896;
}
.main {
  padding: 0;
  overflow: auto;
}
</style>
