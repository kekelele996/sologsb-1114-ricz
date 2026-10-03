import type { Cave, DatumStatus, Segment, Station } from '@/types'
import { round } from '@/utils/survey'

/** 接测高差与累计垂距对账的容差（米） */
export const DATUM_TOLERANCE = 0.1

/** 测量小组累计垂距 = 本段各测点垂距（带符号）求和；无读数时为 null */
export function cumulativeVerticalOf(stations: Pick<Station, 'verticalDistance' | 'dip' | 'slopeDistance'>[]): number | null {
  if (stations.length === 0) return null
  const total = stations.reduce((sum, station) => {
    const value =
      Number.isFinite(station.verticalDistance) && station.verticalDistance !== 0
        ? station.verticalDistance
        : Math.abs(station.slopeDistance) * Math.sin((station.dip * Math.PI) / 180)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  return round(total, 3)
}

/** 登记室接测高差 = 洞口海拔 − 水准点海拔；水准点结论缺失时为 null */
export function levelDeltaOf(cave: Pick<Cave, 'altitude' | 'benchmarkAltitude'>): number | null {
  if (!Number.isFinite(cave.altitude) || cave.benchmarkAltitude === null) return null
  return round(cave.altitude - cave.benchmarkAltitude, 3)
}

/** 两边高差是否对得上（含容差，null 一律视为对不上） */
export function isLevelDeltaMatched(a: number | null, b: number | null, tolerance = DATUM_TOLERANCE): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) <= tolerance
}

export interface SettleInput {
  segment: Pick<
    Segment,
    | 'entranceCode'
    | 'datumLevelDelta'
    | 'cumulativeVertical'
    | 'datumBenchmark'
    | 'datumEntranceAltitude'
    | 'resultAltitude'
  >
  /** 登记室按洞口点名找到的洞口记录，找不到为 null */
  cave: Pick<Cave, 'entranceCode' | 'altitude' | 'datumBenchmark' | 'benchmarkAltitude'> | null
  /** 本次由读数重算出的累计垂距 */
  recomputedVertical: number | null
  /** 登记室最新接测高差，不传则由洞口现算 */
  registryDelta?: number | null
  /** 登记室人工确认的洞口海拔（旧数据回填场景，台账里暂时找不到同点名洞口） */
  manualAltitude?: number | null
  tolerance?: number
}

export interface SettleResult {
  status: DatumStatus
  datumLevelDelta: number | null
  cumulativeVertical: number | null
  datumBenchmark: string
  datumEntranceAltitude: number | null
  datumConfirmedAt: string | null
  resultAltitude: number | null
  datumNote: string
  /** 对账偏差（登记室接测高差 − 累计垂距），无法对账时为 null */
  mismatch: number | null
}

/**
 * 单洞段对账（只重试这一个洞段的原子动作，已认基准的洞段根本不会走到这里）。
 * 1. 按洞口点名找登记室洞口台账，找不到 → 待核；
 * 2. 接测高差 / 累计垂距缺一边，或高差超容差 → 待核，基准归属等登记室水准点结论；
 * 3. 两边对得上 → 按新基准认过，洞段成果高程同步重算。
 * 现场读数不在这里改动，只读不写。
 */
export function settleDatum(input: SettleInput): SettleResult {
  const { segment, tolerance = DATUM_TOLERANCE } = input
  const recomputedVertical = input.recomputedVertical
  // 台账找不到同点名洞口时，允许用登记室人工确认的海拔临时充当洞口结论
  const cave =
    input.cave ??
    (input.manualAltitude !== undefined && input.manualAltitude !== null
      ? {
          entranceCode: segment.entranceCode,
          altitude: input.manualAltitude,
          datumBenchmark: segment.datumBenchmark,
          benchmarkAltitude: null
        }
      : null)
  const cumulativeVertical = recomputedVertical
  const registryDelta =
    input.registryDelta !== undefined ? input.registryDelta : cave === null ? null : levelDeltaOf(cave)

  if (cave === null) {
    return {
      status: 'pending',
      datumLevelDelta: registryDelta,
      cumulativeVertical,
      datumBenchmark: segment.datumBenchmark,
      datumEntranceAltitude: segment.datumEntranceAltitude,
      datumConfirmedAt: null,
      resultAltitude: null,
      datumNote: `洞口点名「${segment.entranceCode || '未认领'}」在登记室台账中对不上，挂账待核`,
      mismatch: null
    }
  }

  if (!isLevelDeltaMatched(registryDelta, cumulativeVertical, tolerance)) {
    const mismatch =
      registryDelta === null || cumulativeVertical === null
        ? null
        : round(registryDelta - cumulativeVertical, 3)
    return {
      status: 'pending',
      datumLevelDelta: registryDelta,
      cumulativeVertical,
      datumBenchmark: cave.datumBenchmark,
      datumEntranceAltitude: cave.altitude,
      datumConfirmedAt: null,
      resultAltitude: null,
      datumNote:
        mismatch === null
          ? `洞口「${cave.entranceCode}」接测高差${registryDelta === null ? '（水准点结论未给）' : ''}与累计垂距${
              cumulativeVertical === null ? '（尚无读数）' : ''
            }暂无法对账，基准归属等登记室结论`
          : `洞口「${cave.entranceCode}」接测高差 ${registryDelta} m 与累计垂距 ${cumulativeVertical} m 相差 ${mismatch} m（容差 ${tolerance} m），挂账待核`,
      mismatch
    }
  }

  const resultAltitude =
    cave.benchmarkAltitude === null
      ? null
      : round(cave.benchmarkAltitude + (registryDelta ?? 0) + (cumulativeVertical ?? 0), 3)
  return {
    status: 'confirmed',
    datumLevelDelta: registryDelta,
    cumulativeVertical,
    datumBenchmark: cave.datumBenchmark,
    datumEntranceAltitude: cave.altitude,
    datumConfirmedAt: new Date().toISOString(),
    resultAltitude,
    datumNote: `洞口「${cave.entranceCode}」接测高差与累计垂距相符（偏差 ${
      cumulativeVertical === null || registryDelta === null
        ? '—'
        : round(Math.abs(registryDelta - cumulativeVertical), 3)
    } m），已按水准点「${cave.datumBenchmark || '—'}」认基准`,
    mismatch: registryDelta === null || cumulativeVertical === null ? null : round(registryDelta - cumulativeVertical, 3)
  }
}

/**
 * 旧数据升级回填：旧洞段没有接测基准，按当时的洞口海拔回填。
 * 回填得上 → 待下轮对账但基准已落账（已认基准、水准点留空）；
 * 回填不上（找不到洞口 / 海拔无效）→ unbackfilled，单列等确认。
 */
export function backfillDatum(
  segment: Pick<Segment, 'entranceCode' | 'caveId'>,
  cave: Pick<Cave, 'id' | 'altitude'> | null,
  vertical: number | null
): Pick<
  Segment,
  'entranceCode' | 'datumStatus' | 'datumBenchmark' | 'datumEntranceAltitude' | 'cumulativeVertical' | 'datumNote' | 'resultAltitude'
> {
  if (cave !== null && Number.isFinite(cave.altitude)) {
    return {
      entranceCode: segment.entranceCode,
      datumStatus: 'confirmed',
      datumBenchmark: '',
      datumEntranceAltitude: cave.altitude,
      cumulativeVertical: vertical,
      datumNote: `旧数据升级：按当时洞口海拔 ${cave.altitude} m 回填基准（无接测水准点记录），待登记室补水准点结论`,
      resultAltitude: vertical === null ? null : round(cave.altitude + vertical, 3)
    }
  }
  return {
    entranceCode: segment.entranceCode,
    datumStatus: 'unbackfilled',
    datumBenchmark: '',
    datumEntranceAltitude: null,
    cumulativeVertical: vertical,
    datumNote: '旧数据升级：缺接测基准且找不到当时洞口海拔，回填不上，单列等确认',
    resultAltitude: null
  }
}
