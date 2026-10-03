import type { Benchmark, Entrance, SegmentElevation, ElevationStatus, DatumSnapshot } from '@/types'
import type { Station } from '@/types'
import { round } from '@/utils/survey'

/** 接测高差与累计垂距对账的默认容差（米） */
export const DEFAULT_HEIGHT_TOLERANCE = 0.1

export interface ReconcileContext {
  result: SegmentElevation
  entrances: Entrance[]
  benchmarks: Benchmark[]
  tolerance?: number
}

export interface ReconcileOutcome {
  status: ElevationStatus
  reason: string
  /** 对账通过时产出的认定基准快照 */
  snapshot: DatumSnapshot | null
  /** 洞段终点高程（米） */
  finalElevation: number | null
}

/** 由测点读数求累计垂距（下降为负、上升为正） */
export function sumCumulativeVertical(stations: Pick<Station, 'verticalDistance' | 'dip'>[]): number {
  const total = stations.reduce((sum, station) => sum + (station.dip < 0 ? -Math.abs(station.verticalDistance) : station.verticalDistance), 0)
  return round(total, 3)
}

/**
 * 单个洞段对账：
 * 1. 按洞口点名去登记室查洞口资料，查无 → 待核；
 * 2. 接测水准点缺失、查无、结论未定 → 由登记室结论决定基准归属（待核/待重算）；
 * 3. 接测高差与测量组累计垂距对不上 → 待核；
 * 4. 全部通过 → 按洞口海拔 + 累计垂距认定终点高程，留存基准快照。
 */
export function reconcileSegment(ctx: ReconcileContext): ReconcileOutcome {
  const { result, entrances, benchmarks } = ctx
  const tolerance = ctx.tolerance ?? DEFAULT_HEIGHT_TOLERANCE
  const entrance = entrances.find((item) => item.name.trim() === result.entranceName.trim())

  if (!entrance) {
    return failed('pendingVerify', `登记室查无洞口点名「${result.entranceName}」，两摊对不上账`)
  }
  if (result.cumulativeVertical === null || !Number.isFinite(result.cumulativeVertical)) {
    return failed('draft', '测量组尚未登记累计垂距，读数不全')
  }
  if (!entrance.benchmarkId) {
    return failed('pendingVerify', `洞口「${entrance.name}」尚未接测水准点，基准归属未定`)
  }

  const benchmark = benchmarks.find((item) => item.id === entrance.benchmarkId)
  if (!benchmark) {
    return failed('pendingVerify', `接测水准点「${entrance.benchmarkId}」在登记室已查无`)
  }
  if (benchmark.conclusion === 'suspended') {
    return failed('pendingVerify', `水准点「${benchmark.name}」结论待核，基准归属暂缓认定`)
  }
  if (benchmark.conclusion === 'revoked') {
    return failed('pendingRecompute', `水准点「${benchmark.name}」已注销，需改接点并按新基准重算`)
  }

  if (entrance.connectionHeightDiff === null) {
    return failed('pendingVerify', `洞口「${entrance.name}」的接测高差尚未登记，无法对打`)
  }
  const diff = round(Math.abs(entrance.connectionHeightDiff - result.cumulativeVertical), 3)
  if (diff > tolerance) {
    return failed(
      'pendingVerify',
      `接测高差 ${entrance.connectionHeightDiff} m 与累计垂距 ${result.cumulativeVertical} m 相差 ${diff} m，超过容差 ${tolerance} m`
    )
  }

  const snapshot: DatumSnapshot = {
    entranceAltitude: entrance.altitude,
    benchmarkId: benchmark.id,
    benchmarkName: benchmark.name,
    benchmarkElevation: benchmark.elevation,
    connectionHeightDiff: entrance.connectionHeightDiff,
    datumVersion: entrance.datumVersion,
    confirmedAt: new Date().toISOString()
  }
  return {
    status: 'confirmed',
    reason: `接测高差与累计垂距相差 ${diff} m（容差 ${tolerance} m），按水准点「${benchmark.name}」认定基准`,
    snapshot,
    finalElevation: round(entrance.altitude + result.cumulativeVertical, 3)
  }
}

function failed(status: ElevationStatus, reason: string): ReconcileOutcome {
  return { status, reason, snapshot: null, finalElevation: null }
}

/**
 * 旧数据升级回填：旧洞段没有接测基准，按「当时的洞口海拔」回填。
 * 回填不上（归属洞穴不存在 / 海拔非数）时单列，等人工确认。
 */
export function buildLegacyBackfill(params: {
  caveAltitude: number | undefined
  caveName: string | undefined
  cumulativeVertical: number | null
  nowIso: string
}): {
  status: ElevationStatus
  reason: string
  snapshot: DatumSnapshot | null
  finalElevation: number | null
} {
  const { caveAltitude, caveName, cumulativeVertical, nowIso } = params
  if (caveName === undefined || caveAltitude === undefined || !Number.isFinite(caveAltitude)) {
    return { status: 'unconfirmed', reason: '升级时找不到对应的洞口资料，洞口海拔回填不上', snapshot: null, finalElevation: null }
  }
  if (cumulativeVertical === null || !Number.isFinite(cumulativeVertical)) {
    return {
      status: 'unconfirmed',
      reason: '升级时按洞口海拔回填，但该洞段没有测点读数、累计垂距缺失',
      snapshot: null,
      finalElevation: null
    }
  }
  const snapshot: DatumSnapshot = {
    entranceAltitude: caveAltitude,
    benchmarkId: '',
    benchmarkName: '（旧数据无接测水准点，按洞口海拔回填）',
    benchmarkElevation: caveAltitude,
    connectionHeightDiff: cumulativeVertical,
    datumVersion: 1,
    confirmedAt: nowIso
  }
  return {
    status: 'confirmed',
    reason: `旧数据无接测基准，升级时按当时洞口海拔 ${caveAltitude} m 回填`,
    snapshot,
    finalElevation: round(caveAltitude + cumulativeVertical, 3)
  }
}
