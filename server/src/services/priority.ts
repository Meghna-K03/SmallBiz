import type { DataStatus } from './forecast'

/**
 * Restock priority: a small, explainable rule set (Phase 8). Deterministic; no AI.
 * It is advice for the shop owner, never an order: nothing is purchased automatically.
 *
 * Stock signals (always applied)
 *   High    Out of stock, or current stock is at or below the minimum stock level.
 *
 * Demand signals (applied only when sales history is `Sufficient`)
 *   High    Current stock covers fewer than HIGH_COVERAGE_DAYS days of expected demand.
 *   Medium  Current stock will not cover the forecast horizon, or the restocking
 *           calculation suggests buying a positive quantity.
 *
 *   Low     Otherwise.
 *
 * When sales history is missing or thin, demand signals are skipped rather than trusted,
 * and the result says so. Stock coverage = current stock / expected units per day.
 */

export const HIGH_COVERAGE_DAYS = 3

export type Priority = 'High' | 'Medium' | 'Low'

export interface PriorityInput {
  currentStock: number
  minStockLevel: number
  /** Days the current stock lasts at the expected daily demand; null when demand is 0 or unknown. */
  stockCoverageDays: number | null
  horizonDays: number
  /** Units the restocking calculation suggests buying (0 = none). */
  recommendedQuantity: number
  dataStatus: DataStatus
}

export interface PriorityResult {
  priority: Priority
  /** The rules that produced the priority, in plain words. */
  reasons: string[]
  /** Advisory wording; never an absolute instruction. */
  advice: string
  /** Set when demand-based rules could not be relied on. */
  reliabilityNote: string | null
}

/** Days for display: whole numbers, and "under 1 day" instead of "0 days" while stock remains. */
const wholeDays = (d: number) => (d < 0.5 ? 'under 1 day' : `${Math.round(d)} ${Math.round(d) === 1 ? 'day' : 'days'}`)

const ADVICE: Record<Priority, string> = {
  High: 'Consider restocking soon.',
  Medium: 'Consider planning a restock.',
  Low: 'No restocking action is suggested right now.',
}

export function assessPriority(i: PriorityInput): PriorityResult {
  const reasons: string[] = []
  let priority: Priority = 'Low'
  const raise = (to: Priority) => {
    if (to === 'High' || priority === 'Low') priority = to
  }

  if (i.currentStock <= 0) {
    raise('High')
    reasons.push('Out of stock.')
  } else if (i.currentStock <= i.minStockLevel) {
    raise('High')
    reasons.push(`Current stock (${i.currentStock}) is at or below the minimum level (${i.minStockLevel}).`)
  }

  const demandReliable = i.dataStatus === 'Sufficient'
  if (demandReliable) {
    if (i.stockCoverageDays !== null && i.stockCoverageDays < HIGH_COVERAGE_DAYS) {
      raise('High')
      reasons.push(`Stock covers about ${wholeDays(i.stockCoverageDays)} of expected demand (under ${HIGH_COVERAGE_DAYS} days).`)
    } else if (i.stockCoverageDays !== null && i.stockCoverageDays < i.horizonDays) {
      raise('Medium')
      reasons.push(`Stock covers about ${wholeDays(i.stockCoverageDays)}, less than the ${i.horizonDays}-day forecast period.`)
    }
    if (i.recommendedQuantity > 0 && priority === 'Low') {
      raise('Medium')
      reasons.push(`Expected demand plus the minimum level is above current stock (suggested quantity ${i.recommendedQuantity}).`)
    }
  }

  if (reasons.length === 0) reasons.push('Stock is above the minimum level and covers the expected demand.')

  const reliabilityNote = demandReliable
    ? null
    : i.dataStatus === 'No Sales'
      ? 'No sales history, so demand-based checks were skipped; only stock levels were used.'
      : 'Limited sales history, so demand-based checks were skipped; only stock levels were used.'

  return { priority, reasons, advice: ADVICE[priority], reliabilityNote }
}

const RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 }

/** Sort key: High first, then Medium, then Low. */
export const priorityRank = (p: Priority) => RANK[p]
