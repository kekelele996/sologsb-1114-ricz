import { createStore } from 'zustand/vanilla'
import type { Segment, SegmentType } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface SegmentState {
  segments: Segment[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (segment: Segment) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByCave: (caveId: string) => Promise<void>
  bulkSetType: (ids: string[], type: SegmentType) => Promise<void>
  bulkSetClosed: (ids: string[], closed: boolean) => Promise<void>
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
    await syncPut<Segment>(db.segments, segment)
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
  }
}))
