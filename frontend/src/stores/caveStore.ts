import { createStore } from 'zustand/vanilla'
import type { Cave, Segment } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface SaveCaveResult {
  cave: Cave
  /** 本次基准变更被挑出来等待高程重算的洞段数 */
  invalidated: number
}

export interface CaveState {
  caves: Cave[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (cave: Cave) => Promise<SaveCaveResult>
  setArchived: (id: string, archived: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** 与洞段基准直接相关的洞口台账字段：改了海拔或换了接测点，旧基准成果即失效 */
function datumFingerprint(cave: Pick<Cave, 'altitude' | 'datumBenchmark' | 'benchmarkAltitude'>): string {
  return JSON.stringify([cave.altitude, cave.datumBenchmark, cave.benchmarkAltitude])
}

export const caveStore = createStore<CaveState>((set, get) => ({
  caves: [],
  loaded: false,
  hydrate: async () => {
    const caves = await syncAll<Cave>(db.caves)
    caves.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    set({ caves, loaded: true })
  },
  save: async (cave) => {
    const previous = get().caves.find((item) => item.id === cave.id)
    await syncPut<Cave>(db.caves, cave)

    // 登记室改过洞口海拔或换了接测点：只挑该洞口中已认基准的洞段挂「待高程重算」，
    // 待核 / 待回填的洞段维持原状；测量现场读数原样保留。
    let invalidated = 0
    if (previous && datumFingerprint(previous) !== datumFingerprint(cave)) {
      const segments = await db.segments.where('caveId').equals(cave.id).toArray()
      const changedBenchmark = previous.datumBenchmark !== cave.datumBenchmark
      await Promise.all(
        segments
          .filter((segment) => segment.datumStatus === 'confirmed')
          .map((segment) => {
            invalidated += 1
            const next: Segment = {
              ...segment,
              datumStatus: 'stale',
              datumConfirmedAt: null,
              resultAltitude: null,
              datumNote: changedBenchmark
                ? `登记室把接测点由「${previous.datumBenchmark || '—'}」换为「${cave.datumBenchmark || '—'}」，旧基准洞段成果失效，挑出待高程重算（读数原样保留）`
                : `登记室把洞口海拔由 ${previous.altitude} m 改为 ${cave.altitude} m，旧基准洞段成果失效，挑出待高程重算（读数原样保留）`
            }
            return syncPut<Segment>(db.segments, next)
          })
      )
    }

    await get().hydrate()
    return { cave, invalidated }
  },
  setArchived: async (id, archived) => {
    const target = get().caves.find((item) => item.id === id)
    if (!target) return
    await syncPut<Cave>(db.caves, { ...target, archived })
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Cave>(db.caves, id)
    await get().hydrate()
  }
}))
