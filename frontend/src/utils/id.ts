/** 生成短唯一 ID */
export function uid(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/** 生成下一个顺序编号，如 P12 -> P13 */
export function nextCode(prefix: string, existing: string[]): string {
  const numbers = existing
    .map((code) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(code.trim())
      return match ? Number(match[1]) : 0
    })
    .filter((n) => n > 0)
  const max = numbers.length > 0 ? Math.max(...numbers) : 0
  return `${prefix}${max + 1}`
}

/** 简易防抖 */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 200): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }) as T
}
