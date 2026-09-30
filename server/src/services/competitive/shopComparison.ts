import { tokens } from './matching'
import { availabilityStatus, round2, type AvailabilityStatus } from './calculations'
import type { PriceObservation } from './types'

/**
 * Shop price vs market price. PURE: the caller passes the shop's products in as plain values
 * (read from the existing Product table by the route); this module never touches the database.
 *
 * A shop product is compared with a market record only on a CONFIRMED match:
 *   1. the shop name states a brand/variant in parentheses, e.g. "Tea (Tata Tea 250g)" (a bare
 *      "Sugar (1kg)" is too generic to match reliably),
 *   2. the shop name states exactly one pack size, in g or kg (ml, L and unit packs cannot be verified
 *      because the market dataset only has a weight field),
 *   3. the record's weight equals that size and any size written in the record's name agrees,
 *   4. the set of product words (sizes and filler words removed) is identical, so extra words such as
 *      "Gold" or "Lite" make it only a `possible` match, which is never compared,
 *   5. exactly one non-conflicting record fits.
 */

export interface ShopProductInput {
  id: string
  name: string
  /** Rupees, from Product.sellingPrice. */
  sellingPrice: number
}

export type ShopMatchStatus = 'confirmed' | 'possible' | 'unmatched'

const STOP = new Set(['and', 'the', 'of', 'with', 'in', 'for', 'pack', 'packs'])
const SIZE = /(\d+(?:\.\d+)?) ?(kg|gms|gm|g|ml|ltr|l)\b/gi

function sizesOf(name: string): { value: number; unit: 'g' | 'ml' }[] {
  const out: { value: number; unit: 'g' | 'ml' }[] = []
  for (const m of name.toLowerCase().matchAll(SIZE)) {
    const n = Number(m[1])
    const u = m[2]
    out.push(u === 'kg' ? { value: n * 1000, unit: 'g' } : u === 'l' || u === 'ltr' ? { value: n * 1000, unit: 'ml' } : { value: n, unit: u === 'ml' ? 'ml' : 'g' })
  }
  return out
}

/** Distinct product words of a name with sizes and filler words removed. */
const words = (name: string): string[] => [...new Set(tokens(name.replace(SIZE, ' ')).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)))]

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w))

export interface ShopMatch {
  status: ShopMatchStatus
  reason: string
  observation: PriceObservation | null
}

export function matchShopProduct(shop: ShopProductInput, records: PriceObservation[]): ShopMatch {
  const none = (status: ShopMatchStatus, reason: string): ShopMatch => ({ status, reason, observation: null })
  const paren = shop.name.match(/\(([^)]*)\)/)
  if (!paren || words(paren[1]).length === 0) return none('unmatched', 'The shop name does not state a brand, so it is too generic to match reliably.')
  const sizes = sizesOf(shop.name)
  if (sizes.length !== 1) return none('unmatched', 'The shop name does not state exactly one pack size.')
  const size = sizes[0]
  const shopWords = words(shop.name)

  const candidates = records.filter((o) => {
    const w = words(o.productName)
    return shopWords.every((x) => w.includes(x))
  })
  if (candidates.length === 0) return none('unmatched', 'No record in the market dataset has this brand and product name.')
  if (size.unit !== 'g') return none('possible', 'The pack size is in ml/L, which the market dataset cannot verify; not compared.')

  const exact = candidates.filter((o) => {
    if (!sameSet(words(o.productName), shopWords)) return false
    if (o.packSizeUnit !== 'g' || o.packSizeValue !== size.value) return false
    return sizesOf(o.productName).every((s) => s.unit === 'g' && s.value === size.value)
  })
  if (exact.length === 1 && !exact[0].conflicting) return { status: 'confirmed', reason: 'Brand, product name and pack size all match.', observation: exact[0] }
  if (exact.length > 0) return none('possible', 'More than one record (or conflicting prices) fits; not compared.')
  return none('possible', 'Similar records exist but the name or pack size differs; not compared.')
}

// ---------- Stage 2: controlled product-identity match ----------
//
// Runs only when the strict matcher above did not confirm a product. It confirms a match only with
// evidence for ALL of: brand, product type, pack size, pack count, and exactly one fitting record.
// It never guesses a brand for a brand-less shop product and never picks between several fits.

/** Safe spelling variants of the same brand (after normalisation). Deliberately tiny; never product-to-product. */
const BRAND_ALIASES: Record<string, string> = { parleg: 'parle g' }

/** Words that describe packaging, not a different product. Extra words outside this set mean a variant. */
const NEUTRAL_EXTRA = new Set(['pouch', 'packet', 'bottle', 'pet', 'jar', 'tetra', 'fresh', 'new'])

const COUNT = /(?:\b(\d+) ?s\b|\bpack of (\d+)\b|\b(\d+) ?(?:x|pk|pcs|pc)\b)/i
const countOf = (name: string): number | null => {
  const m = name.match(COUNT)
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null
}

const canon = (s: string) => {
  const t = tokens(s).join(' ')
  return BRAND_ALIASES[t.replace(/ /g, '')] ?? t
}

/** Brand and product-type words of a shop name like "Tea (Tata Tea 250g)": brand = bracket words not in the type. */
function shopIdentity(name: string): { brand: string[]; type: string[] } | null {
  const paren = name.match(/\(([^)]*)\)/)
  if (!paren) return null
  const type = words(name.replace(paren[0], ' '))
  const inside = words(paren[1])
  const brand = inside.filter((w) => !type.includes(w))
  if (brand.length === 0 || type.length === 0) return null
  return { brand, type }
}

export function matchShopProductStage2(shop: ShopProductInput, records: PriceObservation[]): ShopMatch {
  const none = (status: ShopMatchStatus, reason: string): ShopMatch => ({ status, reason, observation: null })
  const id = shopIdentity(shop.name)
  if (!id) return none('unmatched', 'The shop name does not state both a brand and a product type.')
  const sizes = sizesOf(shop.name)
  if (sizes.length !== 1) return none('unmatched', 'The shop name does not state exactly one pack size.')
  const size = sizes[0]
  const shopCount = countOf(shop.name)
  const brandKey = id.brand.map(canon).join(' ')

  const sameProduct = records.filter((o) => {
    const w = words(o.productName)
    const brandOk = brandKey.split(' ').every((b) => w.includes(b))
    return brandOk && id.type.every((t) => w.includes(t))
  })
  if (sameProduct.length === 0) return none('unmatched', 'No record has this brand and product type.')
  if (size.unit !== 'g') return none('possible', 'The pack size is in ml/L, which the market dataset cannot verify.')

  const sizeFit = sameProduct.filter((o) => {
    if (o.packSizeUnit !== 'g' || o.packSizeValue !== size.value) return false
    if (!sizesOf(o.productName).every((s) => s.unit === 'g' && s.value === size.value)) return false
    const oc = countOf(o.productName)
    return shopCount === oc || (shopCount === null && oc === 1) || (shopCount === 1 && oc === null)
  })
  if (sizeFit.length === 0) return none('unmatched', 'The same brand and product exist only in other pack sizes or pack counts.')
  if (sizeFit.length > 1 || sizeFit.some((o) => o.conflicting)) return none('possible', 'Several different products fit; not compared.')

  const only = sizeFit[0]
  const extra = words(only.productName).filter((w) => !id.type.includes(w) && !brandKey.split(' ').includes(w))
  if (extra.every((w) => NEUTRAL_EXTRA.has(w))) return { status: 'confirmed', reason: 'Brand, product type, pack size and count agree; only one record fits.', observation: only }
  return none('possible', 'The only fitting record is a named variant the shop name does not mention; not compared.')
}

/** Strict matcher first; stage 2 only for products the strict matcher did not confirm. */
export function matchShopProductTwoStage(shop: ShopProductInput, records: PriceObservation[]): ShopMatch {
  const strict = matchShopProduct(shop, records)
  if (strict.status === 'confirmed') return strict
  const second = matchShopProductStage2(shop, records)
  if (second.status === 'confirmed') return second
  // Stage 2 saw the same product in another pack size/count, or several fits: its reason is the accurate one.
  return second.status === 'possible' || second.reason.startsWith('The same brand') ? second : strict
}

export interface ShopComparisonRow {
  shopProductId: string
  shopProductName: string
  shopPriceInr: number
  matchedName: string
  packSizeValue: number | null
  packSizeUnit: string | null
  platform: string
  platformPriceInr: number
  availability: AvailabilityStatus
  /** shop - platform, in rupees (positive: the shop's listed price is higher). */
  differenceInr: number
  /** difference as a percentage of the shop price. */
  differencePercent: number
  verdict: 'shop-higher' | 'shop-lower' | 'similar'
  sourceFile: string
  provenance: string
}

const SIMILAR_WITHIN_PERCENT = 1

export function compareShopToMarket(shop: ShopProductInput[], records: PriceObservation[]) {
  const rows: ShopComparisonRow[] = []
  const counts = { confirmed: 0, possible: 0, unmatched: 0 }
  const possible: { name: string; reason: string }[] = []
  for (const p of shop) {
    const m = matchShopProductTwoStage(p, records)
    counts[m.status]++
    if (m.status === 'possible') possible.push({ name: p.name, reason: m.reason })
    const o = m.observation
    if (m.status !== 'confirmed' || !o) continue
    if (o.available !== true || o.sellingPriceInr === null || o.sellingPriceInr <= 0 || p.sellingPrice <= 0) continue
    const diff = round2(p.sellingPrice - o.sellingPriceInr)
    const pct = round2((diff / p.sellingPrice) * 100)
    rows.push({
      shopProductId: p.id,
      shopProductName: p.name,
      shopPriceInr: round2(p.sellingPrice),
      matchedName: o.productName,
      packSizeValue: o.packSizeValue,
      packSizeUnit: o.packSizeUnit,
      platform: o.platform,
      platformPriceInr: o.sellingPriceInr,
      availability: availabilityStatus(o.available),
      differenceInr: diff,
      differencePercent: pct,
      verdict: Math.abs(pct) <= SIMILAR_WITHIN_PERCENT ? 'similar' : diff > 0 ? 'shop-higher' : 'shop-lower',
      sourceFile: o.sourceFile,
      provenance: o.provenance,
    })
  }
  return { productsChecked: shop.length, matchCounts: counts, possibleProducts: possible, comparisons: rows }
}
