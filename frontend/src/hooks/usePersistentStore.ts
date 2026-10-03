import { onUnmounted, reactive } from 'vue'
import type { StoreApi } from 'zustand/vanilla'
import Dexie, { type Table } from 'dexie'
import type { Cave, Entrance, Benchmark, Segment, SegmentElevation, Sketch, Station } from '@/types'
import { computeHorizontal, computeVertical, round } from '@/utils/survey'
import { buildLegacyBackfill, sumCumulativeVertical } from '@/utils/datum'

/** IndexedDB 数据结构版本号（升级迁移时使用） */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：洞口资料（登记室）/ 洞段成果（测量组）分管 + 元数据表 */
class CaveSurveyDb extends Dexie {
  caves!: Table<Cave, string>
  segments!: Table<Segment, string>
  stations!: Table<Station, string>
  sketches!: Table<Sketch, string>
  /** 登记室：水准点结论 */
  benchmarks!: Table<Benchmark, string>
  /** 登记室：洞口资料（洞口点名为对账键，datumVersion 为基准版本） */
  entrances!: Table<Entrance, string>
  /** 测量组：洞段高程成果 */
  elevations!: Table<SegmentElevation, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbcavesurvey')
    this.version(1).stores({
      caves: 'id, name, region',
      segments: 'id, caveId, code',
      stations: 'id, segmentId, code',
      sketches: 'id, segmentId, code',
      meta: 'key'
    })
    // v2：旧版测点记录缺少水平距/垂距，迁移时由斜距 + 倾角补齐
    this.version(2)
      .stores({
        caves: 'id, name, region, archived',
        segments: 'id, caveId, code, type',
        stations: 'id, segmentId, code, date',
        sketches: 'id, segmentId, code, mergeOrder',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table<Station, string>('stations')
          .toCollection()
          .modify((station) => {
            if (!Number.isFinite(station.horizontalDistance)) {
              station.horizontalDistance = computeHorizontal(station.dip, station.slopeDistance)
            }
            if (!Number.isFinite(station.verticalDistance)) {
              station.verticalDistance = computeVertical(station.dip, station.slopeDistance)
            }
          })
      })
    // v3：洞口资料（登记室）/ 洞内成果（测量组）两摊分管。
    // 旧数据里的洞段没有接测基准，升级时按当时的洞口海拔回填；回填不上的单列等确认。
    this.version(SCHEMA_VERSION)
      .stores({
        benchmarks: 'id, name, conclusion',
        entrances: 'id, caveId, name, benchmarkId, datumVersion',
        elevations: 'id, segmentId, caveId, entranceName, status'
      })
      .upgrade(async (tx) => {
        const caves = await tx.table<Cave, string>('caves').toArray()
        const segments = await tx.table<Segment, string>('segments').toArray()
        const stations = await tx.table<Station, string>('stations').toArray()
        const caveById = new Map(caves.map((cave) => [cave.id, cave]))
        const nowIso = new Date().toISOString()

        // 一个洞穴默认生成一个洞口，洞口点名取洞穴名（两摊按洞口点名对账）
        const entrances: Entrance[] = caves.map((cave) => ({
          id: `ent_up_${cave.id}`,
          caveId: cave.id,
          name: cave.name,
          longitude: cave.longitude,
          latitude: cave.latitude,
          altitude: cave.altitude,
          // 旧洞口没有接测水准点记录，留空，由登记室后续补接测
          benchmarkId: '',
          connectionHeightDiff: null,
          datumVersion: 1,
          updatedAt: nowIso,
          createdAt: nowIso
        }))

        const elevations: SegmentElevation[] = segments.map((segment) => {
          const cave = caveById.get(segment.caveId)
          const ownStations = stations.filter((station) => station.segmentId === segment.id)
          const cumulative = ownStations.length > 0 ? sumCumulativeVertical(ownStations) : null
          const backfill = buildLegacyBackfill({
            caveAltitude: cave?.altitude,
            caveName: cave?.name,
            cumulativeVertical: cumulative,
            nowIso
          })
          return {
            id: `elv_up_${segment.id}`,
            segmentId: segment.id,
            caveId: segment.caveId,
            // 归属洞穴缺失时用洞段编号兜底点名，随后进入「回填待确认」队列人工指认
            entranceName: cave?.name ?? `未指认洞口·${segment.code}`,
            cumulativeVertical: cumulative,
            finalElevation: backfill.finalElevation,
            status: backfill.status,
            datumSnapshot: backfill.snapshot,
            source: 'legacy-backfill',
            note: `升级回填：${backfill.reason}`,
            lastReason: backfill.reason,
            updatedAt: nowIso,
            createdAt: nowIso
          }
        })

        if (entrances.length > 0) await tx.table<Entrance, string>('entrances').bulkPut(entrances)
        if (elevations.length > 0) await tx.table<SegmentElevation, string>('elevations').bulkPut(elevations)
      })
  }
}

export const db = new CaveSurveyDb()

/** 记录当前数据结构版本号，便于后续升级判断 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取表内全部记录 */
export async function syncAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入（新增或更新）一条记录 */
export async function syncPut<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function syncDelete<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** 按条件统计记录数 */
export async function countBy<T extends object>(table: Table<T, string>, predicate: (row: T) => boolean): Promise<number> {
  const rows = await table.toArray()
  return rows.filter(predicate).length
}

/**
 * 把 Zustand 的 vanilla store 桥接到 Vue 响应式状态。
 * store 变化时同步到 reactive 对象，组件卸载时取消订阅。
 */
export function useStore<T extends object>(store: StoreApi<T>): T {
  const state = reactive({ ...store.getState() }) as T
  const unsubscribe = store.subscribe((next: T) => {
    Object.assign(state, next)
  })
  onUnmounted(() => unsubscribe())
  return state
}

/**
 * 首次打开时写入一套示例洞穴数据，保证各页面进入即有事可做。
 * 只在四张表都为空时执行一次。
 */
export async function seedDemoData(): Promise<void> {
  const caveCount = await db.caves.count()
  if (caveCount > 0) return

  const caveId = 'cave_demo_001'
  const segmentA = 'seg_demo_001'
  const segmentB = 'seg_demo_002'
  const segmentC = 'seg_demo_003'

  const entranceEast = 'ent_demo_east'
  const entranceWest = 'ent_demo_west'
  const benchA = 'bm_demo_001'
  const benchB = 'bm_demo_002'

  const today = new Date().toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()

  await db.caves.put({
    id: caveId,
    name: '青龙背斜溶洞',
    region: '黔南州 · 平塘县',
    longitude: 107.2136,
    latitude: 25.8123,
    altitude: 986.4,
    layer: '二叠系下统栖霞组灰岩',
    knownLength: 1240,
    startDate: today,
    surveyor: '陆昀',
    climateNote: '洞内 16.2℃，相对湿度 94%，中段有滴水',
    archived: false,
    createdAt: new Date().toISOString()
  })

  await db.segments.bulkPut([
    {
      id: segmentA,
      caveId,
      code: 'C-01',
      startStake: 'K0+000',
      endStake: 'K0+120',
      type: '廊道',
      avgWidth: 2.4,
      avgHeight: 3.1,
      slopeTrend: '缓升 3°',
      closed: false,
      sketchNo: 'S-01'
    },
    {
      id: segmentB,
      caveId,
      code: 'C-02',
      startStake: 'K0+120',
      endStake: 'K0+195',
      type: '竖井',
      avgWidth: 1.6,
      avgHeight: 12.5,
      slopeTrend: '陡降 68°',
      closed: true,
      sketchNo: 'S-02'
    },
    {
      id: segmentC,
      caveId,
      code: 'C-03',
      startStake: 'K0+195',
      endStake: 'K0+260',
      type: '廊道',
      avgWidth: 2.1,
      avgHeight: 2.6,
      slopeTrend: '缓降 12°',
      closed: false,
      sketchNo: ''
    }
  ])

  await db.stations.bulkPut([
    {
      id: 'st_demo_001',
      segmentId: segmentA,
      code: 'P1',
      bearing: 118.5,
      dip: -2.5,
      slopeDistance: 12.4,
      horizontalDistance: computeHorizontal(-2.5, 12.4),
      verticalDistance: computeVertical(-2.5, 12.4),
      instrumentNo: 'SOKKIA-2',
      surveyor: '陆昀',
      date: today,
      isClosurePoint: false,
      note: '入口段，左壁有崩塌堆积'
    },
    {
      id: 'st_demo_002',
      segmentId: segmentA,
      code: 'P2',
      bearing: 121.2,
      dip: -1.8,
      slopeDistance: 15.8,
      horizontalDistance: computeHorizontal(-1.8, 15.8),
      verticalDistance: computeVertical(-1.8, 15.8),
      instrumentNo: 'SOKKIA-2',
      surveyor: '陆昀',
      date: today,
      isClosurePoint: true,
      note: '本段末站，已与 C-02 起点核对'
    }
  ])

  await db.sketches.bulkPut([
    {
      id: 'sk_demo_001',
      segmentId: segmentA,
      code: 'S-01',
      gridCount: 48,
      scale: 200,
      author: '陆昀',
      mergeOrder: 1,
      anchorStake: 'K0+000',
      imageNote: '平面展开草图，坐标纸 48 格，含左壁支护标注'
    },
    {
      id: 'sk_demo_002',
      segmentId: segmentB,
      code: 'S-02',
      gridCount: 30,
      scale: 200,
      author: '覃羽',
      mergeOrder: 2,
      anchorStake: 'K0+120',
      imageNote: '竖井剖面草图，标注三处锚点'
    }
  ])

  // —— 高程基准两摊分管：登记室（水准点结论 / 洞口资料） ——
  await db.benchmarks.bulkPut([
    {
      id: benchA,
      name: 'BM-青龙-01',
      grade: '国家四等',
      elevation: 988.126,
      conclusion: 'established',
      note: '东入口公路旁基岩标石，2026 年复测',
      createdAt: nowIso
    },
    {
      id: benchB,
      name: 'BM-青龙-02',
      grade: '等外水准',
      elevation: 1041.5,
      conclusion: 'suspended',
      note: '西入口临时引测点，复测成果尚未认定',
      createdAt: nowIso
    },
    {
      id: 'bm_demo_003',
      name: 'BM-旧支洞',
      grade: '等外水准',
      elevation: 990.2,
      conclusion: 'revoked',
      note: '支洞封闭，点已注销',
      createdAt: nowIso
    }
  ])

  // C-01 两站累计垂距 ≈ -1.038 m，作为东入口接测高差，对账吻合
  const cumulativeA = round(
    computeVertical(-2.5, 12.4) * -1 + computeVertical(-1.8, 15.8) * -1,
    3
  )
  await db.entrances.bulkPut([
    {
      id: entranceEast,
      caveId,
      name: '青龙洞·东入口',
      longitude: 107.2136,
      latitude: 25.8123,
      altitude: 986.4,
      benchmarkId: benchA,
      connectionHeightDiff: cumulativeA,
      datumVersion: 1,
      updatedAt: nowIso,
      createdAt: nowIso
    },
    {
      id: entranceWest,
      caveId,
      name: '青龙洞·西入口',
      longitude: 107.1988,
      latitude: 25.8201,
      altitude: 1038.7,
      benchmarkId: benchB,
      connectionHeightDiff: -8.62,
      datumVersion: 1,
      updatedAt: nowIso,
      createdAt: nowIso
    }
  ])

  // —— 测量组：洞段高程成果（现场读数保留在 stations，不在此改写） ——
  await db.elevations.bulkPut([
    {
      id: 'elv_demo_001',
      segmentId: segmentA,
      caveId,
      entranceName: '青龙洞·东入口',
      cumulativeVertical: cumulativeA,
      finalElevation: round(986.4 + cumulativeA, 3),
      status: 'confirmed',
      datumSnapshot: {
        entranceAltitude: 986.4,
        benchmarkId: benchA,
        benchmarkName: 'BM-青龙-01',
        benchmarkElevation: 988.126,
        connectionHeightDiff: cumulativeA,
        datumVersion: 1,
        confirmedAt: nowIso
      },
      source: 'survey',
      note: '入口廊道，已接测认定',
      lastReason: '接测高差与累计垂距吻合，按水准点「BM-青龙-01」认定基准',
      updatedAt: nowIso,
      createdAt: nowIso
    },
    {
      // 接测高差 -8.62 与累计垂距 -12.08 对不上，且水准点结论待核 → 挂待核
      id: 'elv_demo_002',
      segmentId: segmentB,
      caveId,
      entranceName: '青龙洞·西入口',
      cumulativeVertical: -12.08,
      finalElevation: null,
      status: 'pendingVerify',
      datumSnapshot: null,
      source: 'survey',
      note: '竖井一吊到底，人工累计，待与登记室复核',
      lastReason: '接测高差 -8.62 m 与累计垂距 -12.08 m 相差 3.46 m，超过容差 0.1 m',
      updatedAt: nowIso,
      createdAt: nowIso
    },
    {
      // 旧基准（洞口海拔 989.1 / v1）上认过，东入口海拔改成 986.4 后被挑出等重算
      id: 'elv_demo_003',
      segmentId: segmentC,
      caveId,
      entranceName: '青龙洞·东入口',
      cumulativeVertical: -18.4,
      finalElevation: 970.7,
      status: 'pendingRecompute',
      datumSnapshot: {
        entranceAltitude: 989.1,
        benchmarkId: benchA,
        benchmarkName: 'BM-青龙-01',
        benchmarkElevation: 988.126,
        connectionHeightDiff: -18.4,
        datumVersion: 1,
        confirmedAt: nowIso
      },
      source: 'survey',
      note: '登记室修正洞口海拔后挑出，旧基准成果保留待重算',
      lastReason: null,
      updatedAt: nowIso,
      createdAt: nowIso
    },
    {
      // 旧数据升级回填失败的典型：归属洞段资料缺失，单列等人工确认
      id: 'elv_demo_legacy',
      segmentId: 'seg_legacy_orphan',
      caveId,
      entranceName: '未指认洞口·C-99',
      cumulativeVertical: null,
      finalElevation: null,
      status: 'unconfirmed',
      datumSnapshot: null,
      source: 'legacy-backfill',
      note: '升级回填：找不到对应洞口资料且无测点读数，回填不上，单列等确认',
      lastReason: '升级时找不到对应的洞口资料，洞口海拔回填不上',
      updatedAt: nowIso,
      createdAt: nowIso
    }
  ])
}
