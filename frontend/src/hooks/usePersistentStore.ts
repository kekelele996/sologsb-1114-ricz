import { onUnmounted, reactive } from 'vue'
import type { StoreApi } from 'zustand/vanilla'
import Dexie, { type Table } from 'dexie'
import type { Cave, Segment, Sketch, Station } from '@/types'
import { computeHorizontal, computeVertical, round } from '@/utils/survey'
import { backfillDatum, cumulativeVerticalOf } from '@/utils/datum'

/** IndexedDB 数据结构版本号（升级迁移时使用） */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：洞穴 / 洞段 / 测点 / 草图 四张表 + 元数据表 */
class CaveSurveyDb extends Dexie {
  caves!: Table<Cave, string>
  segments!: Table<Segment, string>
  stations!: Table<Station, string>
  sketches!: Table<Sketch, string>
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
    // v3：洞口台账（点名 / 接测水准点）与洞段基准对账。
    // 旧洞段没有接测基准，按当时洞口海拔回填；回填不上的单列（unbackfilled）等确认。
    this.version(SCHEMA_VERSION)
      .stores({
        caves: 'id, name, region, archived, entranceCode, datumBenchmark',
        segments: 'id, caveId, code, type, entranceCode, datumStatus',
        stations: 'id, segmentId, code, date',
        sketches: 'id, segmentId, code, mergeOrder',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        const caveTable = tx.table<Cave, string>('caves')
        const stationTable = tx.table<Station, string>('stations')

        const caves = await caveTable.toArray()
        // 登记室侧：补齐洞口点名 / 接测水准点字段
        const caveByName = new Map<string, Cave>()
        await caveTable.toCollection().modify((cave) => {
          if (!cave.entranceCode) {
            cave.entranceCode = `RK-${String(caves.findIndex((item) => item.id === cave.id) + 1).padStart(2, '0')}`
          }
          if (cave.datumBenchmark === undefined) cave.datumBenchmark = ''
          if (cave.benchmarkAltitude === undefined) cave.benchmarkAltitude = null
          caveByName.set(cave.id, cave)
        })

        // 测量小组侧：旧洞段回填基准；同一升级事务里顺手用读数补累计垂距
        const stations = await stationTable.toArray()
        await tx
          .table<Segment, string>('segments')
          .toCollection()
          .modify((segment) => {
            if (segment.datumStatus !== undefined) return
            const cave = caveByName.get(segment.caveId) ?? null
            const vertical = cumulativeVerticalOf(
              stations.filter((station) => station.segmentId === segment.id)
            )
            if (!segment.entranceCode) {
              segment.entranceCode = cave?.entranceCode ?? ''
            }
            const filled = backfillDatum(segment, cave, vertical)
            segment.datumStatus = filled.datumStatus
            segment.datumBenchmark = filled.datumBenchmark
            segment.datumEntranceAltitude = filled.datumEntranceAltitude
            segment.cumulativeVertical = filled.cumulativeVertical
            segment.datumNote = filled.datumNote
            segment.resultAltitude = filled.resultAltitude
            segment.datumLevelDelta = null
            segment.datumConfirmedAt = null
          })
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

  const today = new Date().toISOString().slice(0, 10)

  // 洞口台账（登记室保管）：洞口点名 RK-01，已接测水准点 BM-青山-07
  await db.caves.put({
    id: caveId,
    name: '青龙背斜溶洞',
    region: '黔南州 · 平塘县',
    longitude: 107.2136,
    latitude: 25.8123,
    altitude: 986.4,
    entranceCode: 'RK-01',
    datumBenchmark: 'BM-青山-07',
    benchmarkAltitude: 987.5,
    layer: '二叠系下统栖霞组灰岩',
    knownLength: 1240,
    startDate: today,
    surveyor: '陆昀',
    climateNote: '洞内 16.2℃，相对湿度 94%，中段有滴水',
    archived: false,
    createdAt: new Date().toISOString()
  })

  const stationRows: Station[] = [
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
  ]

  const verticalA = round(
    stationRows.reduce((sum, station) => sum + station.verticalDistance, 0),
    3
  )
  // 登记室接测高差 986.4 − 987.5 = -1.1 m，C-01 累计垂距与之相符 → 已认基准
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
      slopeTrend: '缓降 2°',
      closed: false,
      sketchNo: 'S-01',
      entranceCode: 'RK-01',
      datumLevelDelta: -1.1,
      cumulativeVertical: verticalA,
      datumStatus: 'confirmed',
      datumBenchmark: 'BM-青山-07',
      datumEntranceAltitude: 986.4,
      datumNote: '洞口「RK-01」接测高差与累计垂距相符，已按水准点「BM-青山-07」认基准',
      datumConfirmedAt: new Date().toISOString(),
      resultAltitude: round(986.4 + verticalA, 3)
    },
    {
      // C-02 尚未录入读数，累计垂距缺失 → 对账时应挂待核
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
      sketchNo: 'S-02',
      entranceCode: 'RK-01',
      datumLevelDelta: -1.1,
      cumulativeVertical: null,
      datumStatus: 'pending',
      datumBenchmark: '',
      datumEntranceAltitude: 986.4,
      datumNote: '尚无测点读数，累计垂距缺失，挂账待核',
      datumConfirmedAt: null,
      resultAltitude: null
    }
  ])

  await db.stations.bulkPut(stationRows)

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
}
