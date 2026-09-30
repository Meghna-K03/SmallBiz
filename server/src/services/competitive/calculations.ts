import type { PriceObservation } from './types'

/**
 * Deterministic price calculations. Pure functions; the backend is the only place
 * these are computed (the AI layer only explains them). A calculation returns null
 * when an input is missing or invalid, never a guess.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

/** Minor currency units (paise) -> rupees. Only call this when the unit has been confirmed. */
export const paiseToInr = (paise: number) => round2(paise / 100)

/** (MRP - selling price) / MRP as a percentage, 1 decimal. Null unless 0 < selling <= MRP. */
export function discountPercent(mrp: number | null, selling: number | null): number | null {
  if (mrp === null || selling === null || mrp <= 0 || selling <= 0 || selling > mrp) return null
  return round1(((mrp - selling) / mrp) * 100)
}

/** priceB - priceA in rupees (positive: B is more expensive). Null unless both prices are valid. */
export function priceDifference(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a <= 0 || b <= 0) return null
  return round2(b - a)
}

/** (priceB - priceA) / priceA as a percentage, 2 decimals. Null unless both prices are valid. */
export function priceDifferencePercent(a: number | null, b: number | null): number | null {
  if (a === null || b === null || a <= 0 || b <= 0) return null
  return round2(((b - a) / a) * 100)
}

export type AvailabilityStatus = 'Available' | 'Out of stock' | 'Unknown'

export const availabilityStatus = (available: boolean | null): AvailabilityStatus =>
  available === null ? 'Unknown' : available ? 'Available' : 'Out of stock'

export interface PlatformPrice {
  platform: string
  sellingPriceInr: number | null
  mrpInr: number | null
  discountPercent: number | null
  available: boolean | null
}

export interface PlatformComparison {
  productId: string
  productName: string
  brand: string | null
  packSizeValue: number | null
  packSizeUnit: string | null
  category: string | null
  platforms: PlatformPrice[]
  /** Lowest selling price among platforms that have a valid price AND are in stock. */
  cheapest: { platform: string; sellingPriceInr: number } | null
  /** Highest price among the same set. */
  highest: { platform: string; sellingPriceInr: number } | null
  /** highest - cheapest, when at least two in-stock platforms have prices. */
  spreadInr: number | null
  spreadPercent: number | null
}

/**
 * Compares one product across platforms. Every observation must be for the SAME product
 * and pack (the caller groups by product id). Only in-stock observations with a valid price
 * are compared; the rest are listed with their availability but excluded from cheapest/spread.
 */
export function comparePlatforms(observations: PriceObservation[]): PlatformComparison | null {
  if (observations.length === 0) return null
  const first = observations[0]
  const platforms: PlatformPrice[] = observations
    .map((o) => ({
      platform: o.platform,
      sellingPriceInr: o.sellingPriceInr,
      mrpInr: o.mrpInr,
      discountPercent: o.discountPercent,
      available: o.available,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform))

  const comparable = platforms.filter(
    (p): p is PlatformPrice & { sellingPriceInr: number } => p.available === true && p.sellingPriceInr !== null && p.sellingPriceInr > 0,
  )
  const sorted = [...comparable].sort((a, b) => a.sellingPriceInr - b.sellingPriceInr || a.platform.localeCompare(b.platform))
  const cheapest = sorted[0] ?? null
  const highest = sorted[sorted.length - 1] ?? null
  const two = sorted.length >= 2
  return {
    productId: first.productId ?? '',
    productName: first.productName,
    brand: first.brand,
    packSizeValue: first.packSizeValue,
    packSizeUnit: first.packSizeUnit,
    category: first.category,
    platforms,
    cheapest: cheapest && { platform: cheapest.platform, sellingPriceInr: cheapest.sellingPriceInr },
    highest: highest && { platform: highest.platform, sellingPriceInr: highest.sellingPriceInr },
    spreadInr: two ? priceDifference(cheapest!.sellingPriceInr, highest!.sellingPriceInr) : null,
    spreadPercent: two ? priceDifferencePercent(cheapest!.sellingPriceInr, highest!.sellingPriceInr) : null,
  }
}

export interface PairComparison {
  platformA: string
  platformB: string
  priceA: number
  priceB: number
  /** priceB - priceA */
  differenceInr: number
  differencePercent: number
}

/** A vs B for one product. Null unless both platforms are in stock with valid prices. */
export function pairComparison(c: PlatformComparison, platformA: string, platformB: string): PairComparison | null {
  const a = c.platforms.find((p) => p.platform === platformA)
  const b = c.platforms.find((p) => p.platform === platformB)
  if (!a || !b || a.available !== true || b.available !== true) return null
  const differenceInr = priceDifference(a.sellingPriceInr, b.sellingPriceInr)
  const differencePercent = priceDifferencePercent(a.sellingPriceInr, b.sellingPriceInr)
  if (differenceInr === null || differencePercent === null) return null
  return { platformA, platformB, priceA: a.sellingPriceInr!, priceB: b.sellingPriceInr!, differenceInr, differencePercent }
}
