import { validationError } from '../../lib/errors'
import type { ComparisonExplainInput } from '../aiExplanation'
import { availabilityStatus, comparePlatforms, pairComparison, priceDifference, priceDifferencePercent } from './calculations'
import type { CompetitiveDataset } from './index'

/**
 * Builds the input for the AI explanation of one comparison. The numbers are looked up in the
 * loaded dataset and calculated here; the client only says WHICH comparison it wants, so it can
 * never supply (or alter) a figure that the AI then explains.
 */

export interface ComparisonRequest {
  productId: string
  kind: ComparisonExplainInput['kind']
  platformA: string
  platformB: string
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseComparisonRequest(body: unknown): ComparisonRequest {
  if (!isObject(body)) throw validationError(['Request body must be a JSON object'])
  const errors: string[] = []
  const text = (field: string, fallback?: string): string => {
    const v = body[field]
    if (v === undefined && fallback !== undefined) return fallback
    if (typeof v !== 'string' || v.trim() === '' || v.length > 60) {
      errors.push(`${field} is required and must be a non-empty string of at most 60 characters`)
      return ''
    }
    return v.trim()
  }
  const productId = text('productId')
  const kind = body.kind
  if (kind !== 'platform-price' && kind !== 'reference-mrp') errors.push('kind must be one of: platform-price, reference-mrp')
  const platformA = text('platformA', 'Zepto')
  const platformB = text('platformB', 'Blinkit')
  if (errors.length > 0) throw validationError(errors)
  return { productId, kind: kind as ComparisonRequest['kind'], platformA, platformB }
}

export function buildComparisonInput(ds: CompetitiveDataset, req: ComparisonRequest): ComparisonExplainInput | null {
  const ref = ds.reference.find((r) => r.productId === req.productId)
  if (!ref) return null
  const name = `${ref.brand} ${ref.productName}`

  if (req.kind === 'reference-mrp') {
    const match = ds.matches.find((m) => m.productId === ref.productId && m.status === 'confirmed' && m.observation)
    const o = match?.observation
    if (!o || o.mrpInr === null) return null
    const differenceInr = priceDifference(ref.referenceMrpInr, o.mrpInr)
    if (differenceInr === null) return null
    return {
      product: name,
      kind: 'reference-mrp',
      basis: 'Provided dataset',
      labelA: 'Reference',
      valueA: ref.referenceMrpInr,
      labelB: o.platform,
      valueB: o.mrpInr,
      differenceInr,
      differencePercent: priceDifferencePercent(ref.referenceMrpInr, o.mrpInr),
      availabilityA: null,
      availabilityB: null,
    }
  }

  // platform-price: prefer collected observations; otherwise the labelled sample rows.
  for (const provenance of ['COLLECTED', 'SAMPLE'] as const) {
    const rows = ds.observations.filter((o) => o.provenance === provenance && o.productId === ref.productId)
    const c = rows.length > 0 ? comparePlatforms(rows) : null
    const pair = c && pairComparison(c, req.platformA, req.platformB)
    if (pair) {
      const a = rows.find((o) => o.platform === req.platformA)!
      const b = rows.find((o) => o.platform === req.platformB)!
      return {
        product: name,
        kind: 'platform-price',
        basis: provenance === 'SAMPLE' ? 'Sample data' : 'Collected',
        labelA: pair.platformA,
        valueA: pair.priceA,
        labelB: pair.platformB,
        valueB: pair.priceB,
        differenceInr: pair.differenceInr,
        differencePercent: pair.differencePercent,
        availabilityA: availabilityStatus(a.available),
        availabilityB: availabilityStatus(b.available),
      }
    }
  }
  return null
}
