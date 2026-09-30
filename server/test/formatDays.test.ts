// Display formatting of days of stock: always whole numbers in the UI, while the calculations
// keep their precise values. The formatter lives in the frontend (src/lib/format.ts); the backend
// priority text follows the same rule.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDays, wholeDays } from '../../src/lib/format'
import { assessPriority } from '../src/services/priority'
import { calcStockCoverageDays } from '../src/services/insights'

describe('days of stock display', () => {
  it('rounds to whole numbers with a consistent rule (half up)', () => {
    assert.equal(formatDays(7.89), '8 days')
    assert.equal(formatDays(4.21), '4 days')
    assert.equal(formatDays(10.67), '11 days')
    assert.equal(formatDays(5.5), '6 days')
    assert.equal(formatDays(5.49), '5 days')
    assert.equal(formatDays(27.67), '28 days')
  })

  it('never shows a decimal point for any value', () => {
    for (let d = 0; d <= 120; d += 0.37) assert.doesNotMatch(formatDays(d), /\./, String(d))
  })

  it('singular, zero, tiny and missing values', () => {
    assert.equal(formatDays(1), '1 day')
    assert.equal(formatDays(1.2), '1 day')
    assert.equal(formatDays(0), '0 days')
    assert.equal(formatDays(0.3), 'under 1 day') // stock remains, so not "0 days"
    assert.equal(formatDays(null), '—')
  })

  it('wholeDays rounds the same way and passes null through', () => {
    assert.equal(wholeDays(4.92), 5)
    assert.equal(wholeDays(null), null)
  })

  it('rounding is display only: the calculation keeps its precise value', () => {
    assert.equal(calcStockCoverageDays(15, 1.9), 7.89)
    assert.equal(formatDays(calcStockCoverageDays(15, 1.9)), '8 days')
  })
})

describe('priority reasons use whole days', () => {
  const base = { currentStock: 15, minStockLevel: 5, horizonDays: 7, recommendedQuantity: 0, dataStatus: 'Sufficient' as const }

  it('High priority reason', () => {
    const r = assessPriority({ ...base, stockCoverageDays: 1.88 })
    assert.match(r.reasons.join(' '), /about 2 days of expected demand/)
    assert.doesNotMatch(r.reasons.join(' '), /1\.88/)
  })

  it('Medium priority reason', () => {
    const r = assessPriority({ ...base, stockCoverageDays: 5.71 })
    assert.match(r.reasons.join(' '), /about 6 days, less than the 7-day forecast period/)
    assert.doesNotMatch(r.reasons.join(' '), /5\.71/)
  })

  it('tiny coverage reads "under 1 day", and the rules themselves are unchanged', () => {
    const r = assessPriority({ ...base, stockCoverageDays: 0.3 })
    assert.equal(r.priority, 'High')
    assert.match(r.reasons.join(' '), /under 1 day of expected demand/)
    assert.equal(assessPriority({ ...base, stockCoverageDays: 2.99 }).priority, 'High') // threshold uses the precise value
    assert.equal(assessPriority({ ...base, stockCoverageDays: 3 }).priority, 'Medium')
  })
})
