import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/caves' },
  {
    path: '/caves',
    name: 'caves',
    component: () => import('@/pages/CavesPage.vue'),
    meta: { title: '洞穴清单' }
  },
  {
    path: '/segments',
    name: 'segments',
    component: () => import('@/pages/SegmentsPage.vue'),
    meta: { title: '洞段编目' }
  },
  {
    path: '/stations',
    name: 'stations',
    component: () => import('@/pages/StationsPage.vue'),
    meta: { title: '测点读数' }
  },
  {
    path: '/sketch',
    name: 'sketch',
    component: () => import('@/pages/SketchPage.vue'),
    meta: { title: '草图工作台' }
  },
  {
    path: '/merge',
    name: 'merge',
    component: () => import('@/pages/MergePage.vue'),
    meta: { title: '图幅拼合' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/caves' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '洞穴测绘草图编目台'
  document.title = `${title} · 洞穴测绘草图编目台`
})

export default router
