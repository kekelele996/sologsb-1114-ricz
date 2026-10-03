import type { ClosureResult, Station } from '@/types'

/** 角度转弧度 */
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 弧度转角度 */
export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

/** 保留 n 位小数（避免浮点噪声） */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 方位角归一到 0-360 */
export function normalizeBearing(deg: number): number {
  const value = deg % 360
  return value < 0 ? value + 360 : value
}

/** 度分秒转十进制度 */
export function dmsToDecimal(d: number, m: number, s: number): number {
  const sign = d < 0 ? -1 : 1
  return sign * (Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600)
}

/** 十进制度转度分秒 */
export function decimalToDms(deg: number): { d: number; m: number; s: number } {
  const sign = deg < 0 ? -1 : 1
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const mFloat = (abs - d) * 60
  const m = Math.floor(mFloat)
  const s = round((mFloat - m) * 60, 1)
  return { d: sign * d, m, s }
}

/** 解析 "123°45'30\"" / "123 45 30" / "123.5" 形式的角值 */
export function parseAngle(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  const dms = /^(-?\d+(?:\.\d+)?)[°\s]+(\d+(?:\.\d+)?)?['′\s]*(\d+(?:\.\d+)?)?["″]?$/.exec(text)
  if (dms) {
    const d = Number(dms[1])
    const m = dms[2] ? Number(dms[2]) : 0
    const s = dms[3] ? Number(dms[3]) : 0
    return round(dmsToDecimal(d, m, s), 4)
  }
  const plain = Number.parseFloat(text)
  return Number.isFinite(plain) ? plain : null
}

/** 格式化为度分秒字符串 */
export function formatDms(deg: number): string {
  const { d, m, s } = decimalToDms(deg)
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(1)}″`
}

/** 校验方位角 */
export function isValidBearing(deg: number): boolean {
  return Number.isFinite(deg) && deg >= 0 && deg < 360
}

/** 校验倾角 */
export function isValidDip(deg: number): boolean {
  return Number.isFinite(deg) && deg >= -90 && deg <= 90
}

/** 由斜距与倾角推算水平距 */
export function computeHorizontal(dip: number, slope: number): number {
  return round(Math.abs(slope) * Math.cos(toRadians(dip)), 3)
}

/** 由斜距与倾角推算垂距 */
export function computeVertical(dip: number, slope: number): number {
  return round(Math.abs(slope) * Math.sin(toRadians(dip)), 3)
}

/** 桩号文本转数字，如 K1+250 -> 1250 */
export function stakeToNumber(stake: string): number {
  const match = /(\d+)\s*\+\s*(\d+)/.exec(stake ?? '')
  if (match) return Number(match[1]) * 1000 + Number(match[2])
  const plain = Number.parseFloat(String(stake ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(plain) ? plain : 0
}

/** 数字转桩号文本，如 1250 -> K1+250 */
export function numberToStake(value: number): string {
  const km = Math.floor(Math.max(0, value) / 1000)
  const m = round(Math.max(0, value) % 1000, 1)
  return `K${km}+${String(Math.floor(m)).padStart(3, '0')}`
}

/** 桩号区间标签 */
export function stakeRangeLabel(start: string, end: string): string {
  return `${start} → ${end}（${round(stakeToNumber(end) - stakeToNumber(start), 2)} m）`
}

/** 桩号区间是否相交 */
export function stakeRangeOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  const lo1 = Math.min(a1, a2)
  const hi1 = Math.max(a1, a2)
  const lo2 = Math.min(b1, b2)
  const hi2 = Math.max(b1, b2)
  return lo1 <= hi2 && lo2 <= hi1
}

/**
 * 闭合差：把每站的方位角与水平距分解为东向/北向增量，
 * 导线闭合差即累计位移向量的模。
 */
export function computeClosure(stations: Station[], threshold = 0.25): ClosureResult {
  let east = 0
  let north = 0
  for (const station of stations) {
    const bearing = toRadians(normalizeBearing(station.bearing))
    const horizontal = station.horizontalDistance || computeHorizontal(station.dip, station.slopeDistance)
    east += horizontal * Math.sin(bearing)
    north += horizontal * Math.cos(bearing)
  }
  const closure = round(Math.hypot(east, north), 3)
  const level: ClosureResult['level'] = closure < threshold * 0.4 ? '优' : closure < threshold ? '良' : '超限'
  return {
    closure,
    threshold,
    over: closure >= threshold,
    level,
    count: stations.length,
    east: round(east, 3),
    north: round(north, 3),
    detail: `东向累计 ΣΔE = ${round(east, 3)} m，北向累计 ΣΔN = ${round(north, 3)} m，闭合差 f = √(ΣΔE² + ΣΔN²) = ${closure} m，阈值 ${threshold} m`
  }
}
