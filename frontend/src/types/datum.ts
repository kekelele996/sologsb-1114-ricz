/** 水准点结论（由普查登记室给出，决定洞段成果的基准归属） */
export const BENCHMARK_CONCLUSIONS = ['established', 'suspended', 'revoked'] as const
export type BenchmarkConclusion = (typeof BENCHMARK_CONCLUSIONS)[number]

export const BENCHMARK_CONCLUSION_META: Record<BenchmarkConclusion, { label: string; type: 'success' | 'warning' | 'info' }> = {
  established: { label: '已认定', type: 'success' },
  suspended: { label: '结论待核', type: 'warning' },
  revoked: { label: '已注销', type: 'info' }
}

/** Benchmark 水准点：普查登记室保管的接测基准 */
export interface Benchmark {
  id: string
  /** 水准点点名，如 BM-青龙-01 */
  name: string
  /** 等级，如 国家四等 */
  grade: string
  /** 水准点高程（米） */
  elevation: number
  /** 登记室给出的结论状态 */
  conclusion: BenchmarkConclusion
  note: string
  createdAt: string
}

/** Entrance 洞口资料：普查登记室保管，洞口点名为两摊对账的唯一键 */
export interface Entrance {
  id: string
  caveId: string
  /** 洞口点名，如 青龙洞·东入口 */
  name: string
  /** 经度 */
  longitude: number
  /** 纬度 */
  latitude: number
  /** 洞口海拔（米） */
  altitude: number
  /** 接测水准点 id；空串表示尚未接测水准点 */
  benchmarkId: string
  /** 洞口接测高差（米）：与测量组累计垂距对打的字段；null 表示尚未登记 */
  connectionHeightDiff: number | null
  /**
   * 基准版本号：洞口海拔或接测水准点（含接测高差）一旦变更就自增，
   * 旧版本上认过的洞段成果据此被挑出、等待按新基准重算。
   */
  datumVersion: number
  updatedAt: string
  createdAt: string
}

/** 洞段高程成果的状态机 */
export const ELEVATION_STATUSES = [
  'draft',
  'confirmed',
  'pendingRecompute',
  'pendingVerify',
  'unconfirmed'
] as const
export type ElevationStatus = (typeof ELEVATION_STATUSES)[number]

export const ELEVATION_STATUS_META: Record<ElevationStatus, { label: string; type: 'success' | 'info' | 'warning' | 'danger' }> = {
  /** 测量组刚录入、尚未对账 */
  draft: { label: '待提交', type: 'info' },
  /** 已按当前基准版本认定 */
  confirmed: { label: '已认基准', type: 'success' },
  /** 登记室改过洞口海拔/接测点，旧基准成果被挑出等待重算 */
  pendingRecompute: { label: '待重算', type: 'warning' },
  /** 对账时洞口点名查无、高差不符或水准点结论未定，挂起待核 */
  pendingVerify: { label: '待核', type: 'danger' },
  /** 旧数据升级时基准回填失败，单列等人工确认 */
  unconfirmed: { label: '回填待确认', type: 'warning' }
}

/** 洞段成果认定基准时留存的快照，保证旧基准成果可回溯、不被静默改写 */
export interface DatumSnapshot {
  /** 认定时的洞口海拔 */
  entranceAltitude: number
  benchmarkId: string
  benchmarkName: string
  benchmarkElevation: number
  /** 认定时登记室侧的接测高差 */
  connectionHeightDiff: number
  /** 认定时的洞口基准版本号 */
  datumVersion: number
  /** 认定时间 */
  confirmedAt: string
}

/** SegmentElevation 洞段高程成果：测量小组保管，现场读数之外的高程结论 */
export interface SegmentElevation {
  id: string
  segmentId: string
  caveId: string
  /** 洞口点名：与登记室洞口资料对账的键 */
  entranceName: string
  /** 测点读数累计垂距（米，上升为正、下降为负） */
  cumulativeVertical: number | null
  /** 洞段终点高程（米），只有已认基准的成果才有值 */
  finalElevation: number | null
  status: ElevationStatus
  /** 认定基准时的快照；待重算时保留旧基准快照不动 */
  datumSnapshot: DatumSnapshot | null
  /** 成果来源：正常测量录入 / 旧数据升级回填 */
  source: 'survey' | 'legacy-backfill'
  note: string
  /** 最近一次对账/重算给出的结论说明（每次对账覆盖，不进备注） */
  lastReason: string | null
  updatedAt: string
  createdAt: string
}
