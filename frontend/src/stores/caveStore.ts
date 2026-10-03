import { createStore } from 'zustand/vanilla'
import type { Cave } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface CaveState {
  caves: Cave[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (cave: Cave) => Promise<void>
  setArchived: (id: string, archived: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
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
    await syncPut<Cave>(db.caves, cave)
    await get().hydrate()
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
