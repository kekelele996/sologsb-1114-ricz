import { createStore } from 'zustand/vanilla'
import type { Cave, DatumStatus, Segment, SegmentType, Station } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { cumulativeVerticalOf, settleDatum } from '@/utils/datum'

export interface ReconcileReport {
  /** 本次参与重试的洞段数 */
  retried: number
  /** 按新基准认过的洞段数 */
  confirmed: number
  /** 仍然对不上、挂账待核的洞段 ID */
  pendingIds: string[]
  /** 缺洞口海拔、回填不上、仍等确认的洞段 ID */
  unbackfilledIds: string[]
}

export interface SegmentState {
  segments: Segment[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (segment: Segment) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByCave: (caveId: string) => Promise<void>
  bulkSetType: (ids: string[], type: SegmentType) => Promise<void>
  bulkSetClosed: (ids: string[], closed: boolean) => Promise<void>
  /** 待高程重算：用现场读数重算累计垂距，再只对这一个洞段重新对账 */
  recompute: (id: string) => Promise<Segment | null>
  /** 对账：按洞口点名逐段重试，已认基准的洞段跳过、不跟着回退 */
  reconcile: (ids?: string[]) => Promise<ReconcileReport>
  /** 旧数据回填不上的洞段，登记室确认洞口海拔后手动补基准并对账 */
  confirmBackfill: (id: string, entranceAltitude: number) => Promise<Segment | null>
}

/** 新洞段的初始基准状态：尚未对账，挂待核 */
function emptyDatum(entranceCode: string, datumLevelDelta: number | null): Pick<
  Segment,
  | 'entranceCode'
  | 'datumLevelDelta'
  | 'cumulativeVertical'
  | 'datumStatus'
  | 'datumBenchmark'
  | 'datumEntranceAltitude'
  | 'datumNote'
  | 'datumConfirmedAt'
  | 'resultAltitude'
> {
  return {
    entranceCode,
    datumLevelDelta,
    cumulativeVertical: null,
    datumStatus: 'pending',
    datumBenchmark: '',
    datumEntranceAltitude: null,
    datumNote: '新洞段尚未对账，挂待核',
    datumConfirmedAt: null,
    resultAltitude: null
  }
}

/** 用读数重算 + 按洞口点名对账，写回这一个洞段（读数不动） */
async function recomputeAndSettle(
  segment: Segment,
  caves: Cave[],
  stations: Station[],
  manualAltitude?: number | null
): Promise<Segment> {
  const vertical = cumulativeVerticalOf(
    stations.filter((station) => station.segmentId === segment.id)
  )
  const cave = segment.entranceCode
    ? caves.find((item) => item.entranceCode === segment.entranceCode) ?? null
    : null
  const settled = settleDatum({
    segment,
    cave,
    recomputedVertical: vertical,
    manualAltitude
  })
  const next: Segment = {
    ...segment,
    cumulativeVertical: settled.cumulativeVertical,
    datumLevelDelta: settled.datumLevelDelta,
    datumStatus: settled.status,
    datumBenchmark: settled.datumBenchmark,
    datumEntranceAltitude: settled.datumEntranceAltitude,
    datumConfirmedAt: settled.datumConfirmedAt,
    resultAltitude: settled.resultAltitude,
    datumNote: settled.datumNote
  }
  await syncPut<Segment>(db.segments, next)
  return next
}

export const segmentStore = createStore<SegmentState>((set, get) => ({
  segments: [],
  loaded: false,
  hydrate: async () => {
    const segments = await syncAll<Segment>(db.segments)
    segments.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ segments, loaded: true })
  },
  save: async (segment) => {
    const existing = get().segments.find((item) => item.id === segment.id)
    // 新建洞段给初始待核状态；编辑时基准生命周期字段不在表单里直接改，
    // 先沿用旧值，但若改了认领洞口，已认基准的洞段要退回待核，等下轮按新点名对账。
    let next: Segment
    if (existing === undefined) {
      next = { ...segment, ...emptyDatum(segment.entranceCode, segment.datumLevelDelta) }
    } else {
      // 表单只提交基准对账两字段（洞口点名 / 接测高差），其余生命周期字段沿用旧账
      next = { ...existing, ...segment }
      if (existing.entranceCode !== segment.entranceCode && existing.datumStatus === 'confirmed') {
        next.datumStatus = 'pending' satisfies DatumStatus
        next.datumConfirmedAt = null
        next.resultAltitude = null
        next.datumNote = `洞口点名由「${existing.entranceCode || '未认领'}」改为「${segment.entranceCode || '未认领'}」，重新挂待核`
      }
    }
    await syncPut<Segment>(db.segments, next)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Segment>(db.segments, id)
    await get().hydrate()
  },
  removeByCave: async (caveId) => {
    const ids = get()
      .segments.filter((item) => item.caveId === caveId)
      .map((item) => item.id)
    await db.segments.bulkDelete(ids)
    await get().hydrate()
  },
  bulkSetType: async (ids, type) => {
    await Promise.all(
      get()
        .segments.filter((item) => ids.includes(item.id))
        .map((item) => syncPut<Segment>(db.segments, { ...item, type }))
    )
    await get().hydrate()
  },
  bulkSetClosed: async (ids, closed) => {
    await Promise.all(
      get()
        .segments.filter((item) => ids.includes(item.id))
        .map((item) => syncPut<Segment>(db.segments, { ...item, closed }))
    )
    await get().hydrate()
  },
  recompute: async (id) => {
    const target = get().segments.find((item) => item.id === id)
    if (!target) return null
    // 对账失败后只重试这一个洞段：即便它当前不是 stale/pending 也按显式操作重算，
    // 但已认基准的洞段不受批量流程影响，单独重算的入口只开给未认基准洞段。
    if (target.datumStatus === 'confirmed') return target
    const [caves, stations] = await Promise.all([syncAll<Cave>(db.caves), syncAll<Station>(db.stations)])
    const next = await recomputeAndSettle(target, caves, stations)
    await get().hydrate()
    return next
  },
  reconcile: async (ids) => {
    const all = get().segments
    const scoped = ids ? all.filter((item) => ids.includes(item.id)) : all
    // 只重试未认基准的洞段；已经按新基准认过的洞段不跟着回退。
    // unbackfilled 缺的是登记室人工确认，批量对账也重试不出结果，留给手动回填。
    const targets = scoped.filter(
      (item) => item.datumStatus === 'stale' || item.datumStatus === 'pending'
    )
    const [caves, stations] = await Promise.all([syncAll<Cave>(db.caves), syncAll<Station>(db.stations)])
    const report: ReconcileReport = {
      retried: targets.length,
      confirmed: 0,
      pendingIds: [],
      unbackfilledIds: scoped.filter((item) => item.datumStatus === 'unbackfilled').map((item) => item.id)
    }
    for (const segment of targets) {
      const next = await recomputeAndSettle(segment, caves, stations)
      if (next.datumStatus === 'confirmed') report.confirmed += 1
      else report.pendingIds.push(next.id)
    }
    await get().hydrate()
    return report
  },
  confirmBackfill: async (id, entranceAltitude) => {
    const target = get().segments.find((item) => item.id === id)
    if (!target || target.datumStatus !== 'unbackfilled') return null
    const withAltitude: Segment = {
      ...target,
      datumStatus: 'pending',
      datumEntranceAltitude: entranceAltitude,
      datumNote: `登记室按确认的洞口海拔 ${entranceAltitude} m 补齐基准，准备对账`
    }
    const [caves, stations] = await Promise.all([syncAll<Cave>(db.caves), syncAll<Station>(db.stations)])
    // 登记室确认后按这一个洞段重试对账；台账暂无同点名洞口时用确认海拔充当洞口结论
    const next = await recomputeAndSettle(withAltitude, caves, stations, entranceAltitude)
    await get().hydrate()
    return next
  }
}))
