/**
 * Daily demand series (pure, no database).
 *
 * The existing baseline forecast only counts days that have sales. Time-series
 * models need every calendar day, so days with no sales are filled with 0 units.
 */

const DAY_MS = 86_400_000

export interface SaleLike {
  productId: string
  quantity: number
  /** YYYY-MM-DD */
  date: string
}

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`)

export function addDays(date: string, n: number): string {
  return new Date(toMs(date) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Every calendar date from start to end, both inclusive. Empty if end is before start. */
export function dateRange(start: string, end: string): string[] {
  const days = Math.round((toMs(end) - toMs(start)) / DAY_MS) + 1
  return days > 0 ? Array.from({ length: days }, (_, i) => addDays(start, i)) : []
}

/**
 * Units sold per calendar day for each product between start and end (inclusive),
 * zero-filled. Sales outside the range are ignored. Products with no sales are
 * absent from the map (callers treat them as all zeros).
 */
export function buildDailySeries(sales: SaleLike[], start: string, end: string): Map<string, number[]> {
  const length = dateRange(start, end).length
  const out = new Map<string, number[]>()
  const startMs = toMs(start)
  for (const s of sales) {
    const index = Math.round((toMs(s.date) - startMs) / DAY_MS)
    if (index < 0 || index >= length) continue
    let series = out.get(s.productId)
    if (!series) {
      series = new Array<number>(length).fill(0)
      out.set(s.productId, series)
    }
    series[index] += s.quantity
  }
  return out
}
