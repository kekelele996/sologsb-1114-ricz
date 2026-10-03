/** Cave 洞穴：作为洞段、测点、草图的归属根节点（普查登记室保管的洞口台账） */
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
  /** 洞口海拔（米） */
  altitude: number
  /** 洞口点名：与测量小组对账的唯一键，如 RK01 */
  entranceCode: string
  /** 接测水准点点名（登记室的接测结论），空串表示尚未接测 */
  datumBenchmark: string
  /** 接测水准点海拔（米），null 表示尚未接测、给不出接测高差 */
  benchmarkAltitude: number | null
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
