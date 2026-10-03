/** Cave 洞穴：作为洞段、测点、草图的归属根节点 */
export interface Cave {
  id: string
  /** 洞穴名 */
  name: string
  /** 行政区 */
  region: string
  /** 经度 */
  longitude: number
  /** 纬度 */
  latitude: number
  /** 海拔（米） */
  altitude: number
  /** 发育层位 */
  layer: string
  /** 已知总长（米） */
  knownLength: number
  /** 测量起始日期 */
  startDate: string
  /** 测绘负责人 */
  surveyor: string
  /** 洞内温湿度备注 */
  climateNote: string
  /** 是否归档 */
  archived: boolean
  createdAt: string
}

export type CaveDraft = Omit<Cave, 'id' | 'createdAt' | 'archived'>
