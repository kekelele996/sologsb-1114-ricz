/** 洞段类型 */
export const SEGMENT_TYPES = ['竖井', '廊道', '厅堂', '裂隙', '水道'] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

/** 洞段类型对应的标签配色 */
export const SEGMENT_TYPE_COLORS: Record<SegmentType, string> = {
  竖井: '#c0392b',
  廊道: '#2f6f8f',
  厅堂: '#8e6bbf',
  裂隙: '#c98a1b',
  水道: '#1f8a70'
}

/**
 * 洞段基准状态（两边对账的生命周期）：
 * - confirmed  已认基准：登记室水准点结论已定，洞段成果按该基准认过
 * - stale      待高程重算：登记室改过洞口海拔 / 换过接测点，旧基准成果失效
 * - pending    待核：按洞口点名对账时接测高差与累计垂距对不上，等登记室结论
 * - unbackfilled 待确认回填：旧数据没有接测基准，升级时连洞口海拔都回填不上
 */
export type DatumStatus = 'confirmed' | 'stale' | 'pending' | 'unbackfilled'

export const DATUM_STATUS_LABELS: Record<DatumStatus, string> = {
  confirmed: '已认基准',
  stale: '待高程重算',
  pending: '待核',
  unbackfilled: '待确认回填'
}

/** Segment 洞段（测量小组保管的洞内成果，现场读数留在测点表原样不动） */
export interface Segment {
  id: string
  caveId: string
  /** 洞段编号，如 C-03 */
  code: string
  /** 起始桩号，如 K0+120 */
  startStake: string
  /** 结束桩号 */
  endStake: string
  type: SegmentType
  /** 平均宽度（米） */
  avgWidth: number
  /** 平均高度（米） */
  avgHeight: number
  /** 坡度趋势描述 */
  slopeTrend: string
  /** 是否已闭合 */
  closed: boolean
  /** 草图序号 */
  sketchNo: string
  /** 对账用洞口点名（认领所属洞口），空串表示尚未认领 */
  entranceCode: string
  /** 登记室接测高差（米）：洞口海拔 − 接测水准点海拔，null 表示水准点结论未给 */
  datumLevelDelta: number | null
  /** 测量小组累计垂距（米）：本段各测点垂距累计（有符号），null 表示尚无读数 */
  cumulativeVertical: number | null
  /** 基准状态 */
  datumStatus: DatumStatus
  /** 认基准时记下的水准点点名 */
  datumBenchmark: string
  /** 认基准时记下的洞口海拔（米） */
  datumEntranceAltitude: number | null
  /** 基准状态备注（失效原因 / 对账偏差 / 回填说明） */
  datumNote: string
  /** 最近一次认基准时间（ISO） */
  datumConfirmedAt: string | null
  /** 重算出的洞段末端高程（米，仅已认基准时有效） */
  resultAltitude: number | null
}

/** 洞段长度 = 起止桩号之差（米） */
export function segmentLength(segment: Pick<Segment, 'startStake' | 'endStake'>): number {
  const toNumber = (stake: string): number => {
    const match = /(\d+)\s*\+\s*(\d+)/.exec(stake)
    if (match) return Number(match[1]) * 1000 + Number(match[2])
    const plain = Number.parseFloat(stake.replace(/[^\d.]/g, ''))
    return Number.isFinite(plain) ? plain : 0
  }
  return Math.max(0, toNumber(segment.endStake) - toNumber(segment.startStake))
}
