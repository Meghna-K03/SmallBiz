// Restock-priority rules and inventory value. Pure: no database.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calcInventoryValue } from '../src/services/analytics'
import { assessPriority, HIGH_COVERAGE_DAYS, priorityRank, type PriorityInput } from '../src/services/priority'

const base: PriorityInput = {
  currentStock: 100,
  minStockLevel: 10,
  stockCoverageDays: 20,
  horizonDays: 7,
  recommendedQuantity: 0,
  dataStatus: 'Sufficient',
}
const assess = (over: Partial<PriorityInput> = {}) => assessPriority({ ...base, ...over })

describe('restock priority', () => {
  it('healthy stock with plenty of cover is Low', () => {
    const r = assess()
    assert.equal(r.priority, 'Low')
    assert.equal(r.reliabilityNote, null)
  })

  it('out of stock is High', () => {
    assert.equal(assess({ currentStock: 0, stockCoverageDays: 0 }).priority, 'High')
  })

  it('at or below the minimum level is High (boundary is inclusive)', () => {
    assert.equal(assess({ currentStock: 10 }).priority, 'High')
    assert.equal(assess({ currentStock: 11 }).priority, 'Low')
  })

  it('less than the high-priority cover is High', () => {
    assert.equal(assess({ stockCoverageDays: HIGH_COVERAGE_DAYS - 0.01 }).priority, 'High')
    assert.equal(assess({ stockCoverageDays: HIGH_COVERAGE_DAYS }).priority, 'Medium') // 3 < 7-day horizon
  })

  it('cover shorter than the forecast horizon is Medium', () => {
    assert.equal(assess({ stockCoverageDays: 5 }).priority, 'Medium')
    assert.equal(assess({ stockCoverageDays: 7 }).priority, 'Low')
  })

  it('a suggested restock quantity alone is Medium', () => {
    assert.equal(assess({ recommendedQuantity: 12 }).priority, 'Medium')
  })

  it('High is not lowered by other rules', () => {
    assert.equal(assess({ currentStock: 5, stockCoverageDays: 30, recommendedQuantity: 0 }).priority, 'High')
  })

  it('thin history: demand rules are skipped and the result says so', () => {
    const r = assess({ dataStatus: 'Limited History', stockCoverageDays: 1, recommendedQuantity: 50 })
    assert.equal(r.priority, 'Low')
    assert.match(r.reliabilityNote!, /Limited sales history/)
  })

  it('no sales history: stock rules still apply', () => {
    const r = assess({ dataStatus: 'No Sales', stockCoverageDays: null, currentStock: 4 })
    assert.equal(r.priority, 'High')
    assert.match(r.reliabilityNote!, /No sales history/)
  })

  it('null coverage (no expected demand) does not trigger demand rules', () => {
    assert.equal(assess({ stockCoverageDays: null }).priority, 'Low')
  })

  it('always gives reasons and advisory wording, never an absolute command', () => {
    for (const over of [{}, { currentStock: 0 }, { stockCoverageDays: 5 }]) {
      const r = assess(over)
      assert.ok(r.reasons.length > 0)
      assert.doesNotMatch(r.advice, /\bmust\b/i)
    }
    assert.equal(assess({ currentStock: 0 }).advice, 'Consider restocking soon.')
  })

  it('orders High before Medium before Low', () => {
    assert.ok(priorityRank('High') < priorityRank('Medium'))
    assert.ok(priorityRank('Medium') < priorityRank('Low'))
  })
})

describe('inventory value', () => {
  it('is current stock x purchase price, summed', () => {
    assert.equal(calcInventoryValue([{ currentStock: 10, purchasePrice: 18.5 }, { currentStock: 4, purchasePrice: 48 }]), 377)
  })

  it('has no floating-point drift (integer cents)', () => {
    assert.equal(calcInventoryValue([{ currentStock: 3, purchasePrice: 0.1 }]), 0.3)
    assert.equal(calcInventoryValue(Array.from({ length: 10 }, () => ({ currentStock: 1, purchasePrice: 0.1 }))), 1)
  })

  it('counts negative stock as zero and handles no products', () => {
    assert.equal(calcInventoryValue([{ currentStock: -5, purchasePrice: 20 }, { currentStock: 2, purchasePrice: 20 }]), 40)
    assert.equal(calcInventoryValue([]), 0)
  })
})
