import type { MatchResult, PriceObservation, ReferenceProduct } from './types'

/**
 * Product matching: reference basket product <-> dataset record. Deliberately strict.
 * A comparison is only built from a CONFIRMED match; uncertain matches are shown but never compared.
 *
 * CONFIRMED needs all of:
 *   1. the record name STARTS with the reference brand,
 *   2. after removing the brand and size words (500g, 1kg ...), the remaining product words are
 *      EXACTLY the reference product words, in the same order (no extra or reordered words),
 *   3. the pack size matches: reference unit `g` and the record's weightInGms is identical, and any
 *      size written in the record's name agrees with it,
 *   4. a multi-pack count in the reference name (3s, 12pk ...) also appears in the record name,
 *   5. exactly one such record exists and it is not flagged as conflicting.
 *
 * NOT matched automatically (kept separate):
 *   - same product in a different pack size or weight, or a name whose size contradicts its weight;
 *   - a name with extra or reordered words ("Salt" vs "Salt Lite"): a possible variant, `possible`;
 *   - ml and unit-count packs: the dataset only has weightInGms, so the pack cannot be verified;
 *   - a reference multi-pack (e.g. "3s") the record does not mention: the pack cannot be verified;
 *   - brand-less produce (brand "Fresh"): too ambiguous to match reliably.
 */

const STOP = new Set(['and', 'the', 'of', 'with', 'in', 'for'])
const SIZE_TOKEN = /^\d+(g|gm|gms|kg|ml|l|ltr|pk|pcs|pc|s)$/
/** A multi-pack count such as 3s, 12pk, 6pcs. */
const COUNT_TOKEN = /^\d+(pk|pcs|pc|s)$/
const SIZE_IN_NAME = /\b(\d+(?:\.\d+)?) ?(kg|gms|gm|g|ml|ltr|l)\b/g
const GENERIC_BRANDS = new Set(['fresh'])

/** Lowercase, accents and apostrophes removed, other punctuation and non-breaking spaces to single spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ ]/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const tokens = (s: string): string[] => (normalizeName(s) === '' ? [] : normalizeName(s).split(' '))

const meaningful = (t: string[]) => t.filter((w) => !STOP.has(w) && !SIZE_TOKEN.test(w))

/** Sizes written inside a product name ("500g", "1 kg", "1 L"), converted to g or ml. */
function sizesInName(name: string): { value: number; unit: 'g' | 'ml' }[] {
  const out: { value: number; unit: 'g' | 'ml' }[] = []
  for (const m of name.toLowerCase().replace(/\u00a0/g, ' ').matchAll(SIZE_IN_NAME)) {
    const n = Number(m[1])
    out.push(m[2] === 'kg' ? { value: n * 1000, unit: 'g' } : m[2] === 'l' || m[2] === 'ltr' ? { value: n * 1000, unit: 'ml' } : { value: n, unit: m[2] === 'ml' ? 'ml' : 'g' })
  }
  return out
}

/** Index where `needle` appears as a contiguous run inside `haystack`, or -1. */
function findRun(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return -1
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return i
  }
  return -1
}

type NameFit = 'equal' | 'extra-words' | 'none'
type PackFit = 'same' | 'different' | 'unverifiable'

/** Tokens of a name with written sizes ("500g", "1 kg", "1.5 L") removed first, so they never count as product words. */
const productTokens = (name: string) => tokens(name.toLowerCase().replace(/\u00a0/g, ' ').replace(SIZE_IN_NAME, ' '))

function fit(ref: ReferenceProduct, o: PriceObservation): { name: NameFit; pack: PackFit } | null {
  const brand = tokens(ref.brand)
  const rec = productTokens(o.productName)
  const at = findRun(rec, brand)
  if (at !== 0) return null // the name must start with the brand; otherwise it is not a candidate
  const recRest = meaningful([...rec.slice(0, at), ...rec.slice(at + brand.length)])
  const refWords = productTokens(ref.productName)
  const refBrandAt = findRun(refWords, brand)
  const refRest = meaningful(refBrandAt >= 0 ? [...refWords.slice(0, refBrandAt), ...refWords.slice(refBrandAt + brand.length)] : refWords)
  if (refRest.length === 0) return null
  if (refRest.some((w) => !recRest.includes(w))) return { name: 'none', pack: 'unverifiable' }
  // Equal only when the words are identical AND in the same order; anything else is a possible variant.
  const name: NameFit = recRest.length === refRest.length && recRest.every((w, i) => w === refRest[i]) ? 'equal' : 'extra-words'

  let pack: PackFit
  if (ref.packSizeUnit !== 'g') pack = 'unverifiable'
  else if (o.packSizeUnit === 'g' && o.packSizeValue === ref.packSizeValue) {
    // A size written in the name must agree with the weight field.
    const contradicts = sizesInName(o.productName).some((s) => s.unit !== 'g' || s.value !== ref.packSizeValue)
    pack = contradicts ? 'different' : 'same'
  } else pack = 'different'
  // A multi-pack count in the reference (3s, 12pk) must be visible in the record, otherwise the pack is unverified.
  const counts = tokens(ref.productName).filter((w) => COUNT_TOKEN.test(w))
  if (pack === 'same' && counts.some((c) => !tokens(o.productName).includes(c))) pack = 'unverifiable'
  return { name, pack }
}

const brief = (o: PriceObservation) => ({
  productName: o.productName,
  packSizeValue: o.packSizeValue,
  sellingPriceInr: o.sellingPriceInr,
})

export function matchProduct(ref: ReferenceProduct, records: PriceObservation[]): MatchResult {
  const base = { productId: ref.productId, observation: null, candidates: [] as MatchResult['candidates'] }

  if (GENERIC_BRANDS.has(normalizeName(ref.brand))) {
    return { ...base, status: 'unmatched', reasons: ['Brand-less fresh produce cannot be matched reliably by name.'] }
  }

  const fits = records
    .map((o) => ({ o, f: fit(ref, o) }))
    .filter((x): x is { o: PriceObservation; f: { name: NameFit; pack: PackFit } } => x.f !== null && x.f.name !== 'none')

  const exact = fits.filter((x) => x.f.name === 'equal' && x.f.pack === 'same')
  if (exact.length === 1 && !exact[0].o.conflicting) {
    return { ...base, status: 'confirmed', reasons: ['Brand, product name and pack size all match.'], observation: exact[0].o }
  }
  if (exact.length > 1 || exact.some((x) => x.o.conflicting)) {
    return {
      ...base,
      status: 'ambiguous',
      reasons: ['More than one record (or conflicting prices) fits this product and pack; not compared.'],
      candidates: exact.slice(0, 3).map((x) => brief(x.o)),
    }
  }

  const unverifiable = fits.filter((x) => x.f.name === 'equal' && x.f.pack === 'unverifiable')
  if (unverifiable.length > 0) {
    return {
      ...base,
      status: 'possible',
      reasons: [`The name matches but the pack size (${ref.packSizeValue} ${ref.packSizeUnit}) cannot be verified from the dataset (unit or multi-pack not stated); not compared.`],
      candidates: unverifiable.slice(0, 3).map((x) => brief(x.o)),
    }
  }

  const otherPack = fits.filter((x) => x.f.name === 'equal' && x.f.pack === 'different')
  if (otherPack.length > 0) {
    const sizes = [...new Set(otherPack.map((x) => x.o.packSizeValue))].filter((v) => v !== null).join(', ')
    return {
      ...base,
      status: 'unmatched',
      reasons: [`The same product exists only in other pack sizes (${sizes} g); the reference is ${ref.packSizeValue} ${ref.packSizeUnit}.`],
    }
  }

  const variants = fits.filter((x) => x.f.name === 'extra-words' && x.f.pack !== 'different')
  if (variants.length > 0) {
    return {
      ...base,
      status: 'possible',
      reasons: ['Similar records exist but their names differ (extra or reordered words, possibly a different variant); not compared.'],
      candidates: variants.slice(0, 3).map((x) => brief(x.o)),
    }
  }
  return { ...base, status: 'unmatched', reasons: ['No record with this brand and product name in the dataset.'] }
}

export function matchReferenceProducts(refs: ReferenceProduct[], records: PriceObservation[]): MatchResult[] {
  return refs.map((r) => matchProduct(r, records))
}
