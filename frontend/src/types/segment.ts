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

/** Segment 洞段 */
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
