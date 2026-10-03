import { createStore } from 'zustand/vanilla'
import type { Benchmark, Entrance, ElevationStatus, SegmentElevation } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'
import { reconcileSegment } from '@/utils/datum'
import { uid } from '@/utils/id'

/** 洞口资料保存时的提交字段（id/版本号由 store 维护） */
export type EntranceDraft = Omit<Entrance, 'id' | 'datumVersion' | 'updatedAt' | 'createdAt'> & {
  id?: string
}

/** 洞段高程成果保存时的提交字段 */
export type ElevationDraft = Pick<SegmentElevation, 'segmentId' | 'caveId' | 'entranceName' | 'cumulativeVertical' | 'note'>

export interface DatumState {
  benchmarks: Benchmark[]
  entrances: Entrance[]
  elevations: SegmentElevation[]
  loaded: boolean
  hydrate: () => Promise<void>
  saveBenchmark: (draft: Omit<Benchmark, 'id' | 'createdAt'> & { id?: string }) => Promise<void>
  removeBenchmark: (id: string) => Promise<void>
  saveEntrance: (draft: EntranceDraft) => Promise<{ bumped: boolean }>
  removeEntrance: (id: string) => Promise<void>
  saveElevation: (draft: ElevationDraft, editingId?: string | null) => Promise<void>
  removeElevation: (id: string) => Promise<void>
  removeElevationsBySegment: (segmentId: string) => Promise<void>
  removeElevationsByCave: (caveId: string) => Promise<void>
  /** 只重试这一个洞段；已经按新基准认过的成果不跟着回退 */
  reconcileOne: (id: string, tolerance?: number) => Promise<SegmentElevation | null>
  /** 批量对账：跳过已认基准与回填待确认，只处理挂起/草稿成果 */
  reconcilePending: (tolerance?: number) => Promise<number>
  /** 回填待确认队列：人工指认洞口点名后重新对账 */
  assignUnconfirmed: (id: string, entranceName: string, cumulativeVertical: number, tolerance?: number) => Promise<void>
}

export const datumStore = createStore<DatumState>((set, get) => ({
  benchmarks: [],
  entrances: [],
  elevations: [],
  loaded: false,

  hydrate: async () => {
    const [benchmarks, entrances, elevations] = await Promise.all([
      syncAll<Benchmark>(db.benchmarks),
      syncAll<Entrance>(db.entrances),
      syncAll<SegmentElevation>(db.elevations)
    ])
    benchmarks.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    entrances.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    set({ benchmarks, entrances, elevations, loaded: true })
  },

  saveBenchmark: async (draft) => {
    const existing = draft.id ? get().benchmarks.find((item) => item.id === draft.id) : undefined
    const row: Benchmark = {
      id: existing?.id ?? draft.id ?? uid('bm'),
      name: draft.name.trim(),
      grade: draft.grade.trim(),
      elevation: draft.elevation,
      conclusion: draft.conclusion,
      note: draft.note.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString()
    }
    await syncPut<Benchmark>(db.benchmarks, row)
    await get().hydrate()
  },

  removeBenchmark: async (id) => {
    await db.benchmarks.delete(id)
    await get().hydrate()
  },

  saveEntrance: async (draft) => {
    const nowIso = new Date().toISOString()
    const existing = draft.id ? get().entrances.find((item) => item.id === draft.id) : undefined
    // 洞口海拔或接测基准（水准点 / 接测高差）一旦变动，基准版本自增
    const datumChanged =
      existing !== undefined &&
      (existing.altitude !== draft.altitude ||
        existing.benchmarkId !== draft.benchmarkId ||
        existing.connectionHeightDiff !== draft.connectionHeightDiff)
    const datumVersion = existing ? (datumChanged ? existing.datumVersion + 1 : existing.datumVersion) : 1
    const row: Entrance = {
      id: existing?.id ?? draft.id ?? uid('ent'),
      caveId: draft.caveId,
      name: draft.name.trim(),
      longitude: draft.longitude,
      latitude: draft.latitude,
      altitude: draft.altitude,
      benchmarkId: draft.benchmarkId,
      connectionHeightDiff: draft.connectionHeightDiff,
      datumVersion,
      updatedAt: nowIso,
      createdAt: existing?.createdAt ?? nowIso
    }
    await syncPut<Entrance>(db.entrances, row)

    // 只挑出「旧基准版本上已认基准」的洞段成果挂待重算；
    // 待核/草稿/待重算本来就没认基准，已按新版本认过的不回退。
    if (datumChanged && existing) {
      const stale = get().elevations.filter(
        (item) =>
          item.status === 'confirmed' &&
          item.entranceName === existing.name &&
          (item.datumSnapshot?.datumVersion ?? 0) < datumVersion
      )
      for (const item of stale) {
        const marker = '洞口基准变更，旧基准成果挑出等待高程重算'
        await syncPut<SegmentElevation>(db.elevations, {
          ...item,
          status: 'pendingRecompute',
          note: item.note.includes(marker)
            ? item.note
            : item.note
              ? `${marker}；${item.note}`
              : marker,
          lastReason: `洞口「${existing.name}」基准更新到版本 ${datumVersion}，该成果基于版本 ${
            item.datumSnapshot?.datumVersion ?? '?'
          } 认定，挑出等待高程重算`,
          updatedAt: nowIso
        })
      }
    }

    await get().hydrate()
    return { bumped: datumChanged }
  },

  removeEntrance: async (id) => {
    await db.entrances.delete(id)
    await get().hydrate()
  },

  saveElevation: async (draft, editingId) => {
    const nowIso = new Date().toISOString()
    const existing = editingId ? get().elevations.find((item) => item.id === editingId) : undefined
    if (existing) {
      // 现场读数照旧原样留着；改的是成果侧累计垂距/洞口点名，已认过的成果改后回到待提交重新对账
      const touched = existing.entranceName !== draft.entranceName.trim() || existing.cumulativeVertical !== draft.cumulativeVertical
      const nextStatus: ElevationStatus =
        existing.status === 'confirmed' && touched ? 'draft' : existing.status
      await syncPut<SegmentElevation>(db.elevations, {
        ...existing,
        segmentId: draft.segmentId,
        caveId: draft.caveId,
        entranceName: draft.entranceName.trim(),
        cumulativeVertical: draft.cumulativeVertical,
        note: draft.note.trim(),
        status: nextStatus,
        ...(touched ? { finalElevation: null, datumSnapshot: null, lastReason: null } : {}),
        updatedAt: nowIso
      })
    } else {
      const row: SegmentElevation = {
        id: uid('elv'),
        segmentId: draft.segmentId,
        caveId: draft.caveId,
        entranceName: draft.entranceName.trim(),
        cumulativeVertical: draft.cumulativeVertical,
        finalElevation: null,
        status: 'draft',
        datumSnapshot: null,
        source: 'survey',
        note: draft.note.trim(),
        lastReason: null,
        updatedAt: nowIso,
        createdAt: nowIso
      }
      await syncPut<SegmentElevation>(db.elevations, row)
    }
    await get().hydrate()
  },

  removeElevation: async (id) => {
    await db.elevations.delete(id)
    await get().hydrate()
  },

  removeElevationsBySegment: async (segmentId) => {
    const ids = get()
      .elevations.filter((item) => item.segmentId === segmentId)
      .map((item) => item.id)
    await db.elevations.bulkDelete(ids)
    await get().hydrate()
  },

  removeElevationsByCave: async (caveId) => {
    const ids = get()
      .elevations.filter((item) => item.caveId === caveId)
      .map((item) => item.id)
    await db.elevations.bulkDelete(ids)
    await get().hydrate()
  },

  reconcileOne: async (id, tolerance) => {
    const state = get()
    const result = state.elevations.find((item) => item.id === id)
    if (!result || result.status === 'unconfirmed') return null
    // 已经按当前基准认过的成果不参与重试，避免对账失败把它带回退
    const entrance = state.entrances.find((item) => item.name === result.entranceName)
    if (
      result.status === 'confirmed' &&
      entrance &&
      result.datumSnapshot?.datumVersion === entrance.datumVersion
    ) {
      return result
    }
    const outcome = reconcileSegment({
      result,
      entrances: state.entrances,
      benchmarks: state.benchmarks,
      tolerance
    })
    const row: SegmentElevation = {
      ...result,
      status: outcome.status,
      datumSnapshot: outcome.snapshot,
      finalElevation: outcome.finalElevation,
      lastReason: outcome.reason,
      updatedAt: new Date().toISOString()
    }
    await syncPut<SegmentElevation>(db.elevations, row)
    await get().hydrate()
    return row
  },

  reconcilePending: async (tolerance) => {
    const state = get()
    // 只重试挂起的这些洞段；confirmed / unconfirmed 一律不动
    const candidates = state.elevations.filter(
      (item) => item.status === 'draft' || item.status === 'pendingVerify' || item.status === 'pendingRecompute'
    )
    let confirmedCount = 0
    for (const item of candidates) {
      const outcome = reconcileSegment({
        result: item,
        entrances: state.entrances,
        benchmarks: state.benchmarks,
        tolerance
      })
      const row: SegmentElevation = {
        ...item,
        status: outcome.status,
        datumSnapshot: outcome.snapshot,
        finalElevation: outcome.finalElevation,
        lastReason: outcome.reason,
        updatedAt: new Date().toISOString()
      }
      await syncPut<SegmentElevation>(db.elevations, row)
      if (outcome.status === 'confirmed') confirmedCount += 1
    }
    await get().hydrate()
    return confirmedCount
  },

  assignUnconfirmed: async (id, entranceName, cumulativeVertical, tolerance) => {
    const state = get()
    const result = state.elevations.find((item) => item.id === id)
    if (!result) return
    const prepared: SegmentElevation = {
      ...result,
      entranceName: entranceName.trim(),
      cumulativeVertical,
      status: 'draft',
      source: 'survey',
      note: `人工指认洞口并补累计垂距；${result.note}`,
      lastReason: null
    }
    const outcome = reconcileSegment({
      result: prepared,
      entrances: state.entrances,
      benchmarks: state.benchmarks,
      tolerance
    })
    const row: SegmentElevation = {
      ...prepared,
      status: outcome.status,
      datumSnapshot: outcome.snapshot,
      finalElevation: outcome.finalElevation,
      lastReason: outcome.reason,
      updatedAt: new Date().toISOString()
    }
    await syncPut<SegmentElevation>(db.elevations, row)
    await get().hydrate()
  }
}))
