// Forecasting tests: daily series, models, temporal split, MAE/WAPE, and proof that
// future (validation/test) data never influences training or model selection.
// All pure: plain arrays, no database. The series below are small hand-made test fixtures.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mae, MIN_BACKTEST_DAYS, planSplit, runBacktest, wape } from '../src/services/forecasting/backtest'
import { assessDataQuality, runForecastPipeline } from '../src/services/forecasting'
import { chooseAlpha, getModel, MODELS } from '../src/services/forecasting/models'
import { addDays, buildDailySeries, dateRange } from '../src/services/forecasting/series'

const repeat = (value: number, n: number) => Array.from({ length: n }, () => value)

describe('daily series', () => {
  it('lists every calendar day, inclusive', () => {
    assert.deepEqual(dateRange('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    assert.deepEqual(dateRange('2026-03-02', '2026-03-01'), [])
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  })

  it('fills days without sales with 0, sums same-day sales and ignores dates outside the range', () => {
    const sales = [
      { productId: 'a', quantity: 3, date: '2026-01-01' },
      { productId: 'a', quantity: 2, date: '2026-01-01' },
      { productId: 'a', quantity: 4, date: '2026-01-03' },
      { productId: 'a', quantity: 99, date: '2026-01-09' },
      { productId: 'b', quantity: 1, date: '2026-01-05' },
    ]
    const series = buildDailySeries(sales, '2026-01-01', '2026-01-05')
    assert.deepEqual(series.get('a'), [5, 0, 4, 0, 0])
    assert.deepEqual(series.get('b'), [0, 0, 0, 0, 1])
    assert.equal(series.get('c'), undefined)
  })
})

describe('models', () => {
  const predict = (name: Parameters<typeof getModel>[0], history: number[], horizon = 3) =>
    getModel(name).predict(history, horizon)

  it('historical mean is the average of all history', () => {
    assert.deepEqual(predict('historical-mean', [2, 4, 6]), [4, 4, 4])
  })

  it('moving average uses only the most recent 7 days', () => {
    assert.deepEqual(predict('moving-average', [100, 1, 1, 1, 1, 1, 1, 1], 2), [1, 1])
    assert.deepEqual(predict('moving-average', [2, 4], 1), [3]) // fewer than 7 days: uses what exists
  })

  it('exponential smoothing follows a level shift more closely than the plain mean', () => {
    const history = [...repeat(0, 10), ...repeat(10, 10)]
    const [mean] = predict('historical-mean', history, 1)
    const [smoothed] = predict('exponential-smoothing', history, 1)
    assert.ok(smoothed > mean, `${smoothed} should be above ${mean}`)
    assert.ok(smoothed <= 10)
  })

  it('a constant series is forecast as that constant by every model', () => {
    for (const m of MODELS) assert.deepEqual(m.predict(repeat(4, 20), 2), [4, 4])
  })

  it('handles empty history without NaN', () => {
    for (const m of MODELS) assert.deepEqual(m.predict([], 2), [0, 0])
  })

  it('chooses the smoothing weight from history only and deterministically', () => {
    assert.equal(chooseAlpha(repeat(3, 10)), 0.1)
    assert.equal(chooseAlpha([1, 5, 2, 8, 3]), chooseAlpha([1, 5, 2, 8, 3]))
  })

  it('is baseline-first so ties keep the simpler model', () => {
    assert.equal(MODELS[0].name, 'historical-mean')
  })
})

describe('split plan', () => {
  it('needs at least 21 days: 7 train + 7 validation + 7 test', () => {
    assert.equal(MIN_BACKTEST_DAYS, 21)
    assert.equal(planSplit(20), null)
    assert.deepEqual(planSplit(21), { trainDays: 7, validationDays: 7, testDays: 7 })
    assert.deepEqual(planSplit(42), { trainDays: 28, validationDays: 7, testDays: 7 })
  })
})

describe('MAE and WAPE', () => {
  it('computes known values', () => {
    assert.equal(mae([2, 4], [3, 3]), 1)
    assert.equal(wape([2, 4], [3, 3]), 0.3333) // 2 / 6
    assert.equal(mae([0, 0], [1, 1]), 1)
  })

  it('WAPE is null (not NaN or Infinity) when nothing was sold', () => {
    assert.equal(wape([0, 0, 0], [1, 1, 1]), null)
    assert.equal(mae([], []), null)
  })

  it('a perfect forecast has zero error', () => {
    assert.equal(mae([3, 5], [3, 5]), 0)
    assert.equal(wape([3, 5], [3, 5]), 0)
  })
})

// 42 days: sales level rises from 2 to 10 per day at day 14, then stays there.
// Train = days 0-27, validation = 28-34, test = 35-41.
const shiftSeries = () => [...repeat(2, 14), ...repeat(10, 28)]
const plan42 = planSplit(42)!

describe('backtest: model selection and test accuracy', () => {
  it('selects a recency-aware model on a level shift and beats the baseline on held-out days', () => {
    const result = runBacktest(new Map([['p', shiftSeries()]]), plan42)
    assert.equal(result.selectedModel, 'moving-average') // exactly right after the shift; the mean is not
    const p = result.products.get('p')!
    assert.deepEqual(p.selected.predicted, repeat(10, 7))
    assert.equal(p.selected.metrics.mae, 0)
    // baseline: mean of train+validation = (14*2 + 21*10) / 35 = 238 / 35 = 6.8 -> error 3.2 per day
    assert.equal(p.baseline.metrics.mae, 3.2)
    assert.equal(p.baseline.metrics.wape, 0.32) // 3.2 / 10
    assert.equal(result.pooled.selected.mae, 0)
    assert.equal(result.pooled.baseline.mae, 3.2)
  })

  it('keeps the baseline when no model does better (tie)', () => {
    const result = runBacktest(new Map([['p', repeat(5, 42)]]), plan42)
    assert.equal(result.selectedModel, 'historical-mean')
  })

  it('reports validation scores for every model', () => {
    const result = runBacktest(new Map([['p', shiftSeries()]]), plan42)
    assert.deepEqual(result.modelSelection.map((m) => m.model), MODELS.map((m) => m.name))
  })
})

describe('no temporal leakage', () => {
  it('changing TEST values never changes model selection or the test predictions', () => {
    const original = shiftSeries()
    const tampered = original.map((v, i) => (i >= 35 ? v * 7 + 3 : v)) // rewrite only the 7 test days
    const a = runBacktest(new Map([['p', original]]), plan42)
    const b = runBacktest(new Map([['p', tampered]]), plan42)

    assert.equal(a.selectedModel, b.selectedModel)
    assert.deepEqual(a.modelSelection, b.modelSelection)
    assert.deepEqual(a.products.get('p')!.selected.predicted, b.products.get('p')!.selected.predicted)
    assert.deepEqual(a.products.get('p')!.baseline.predicted, b.products.get('p')!.baseline.predicted)
    // The reported error must change, otherwise the test window is not really being scored.
    assert.notDeepEqual(a.products.get('p')!.selected.metrics, b.products.get('p')!.selected.metrics)
  })

  it('changing VALIDATION values never changes what a model fitted on TRAIN predicts', () => {
    const original = shiftSeries()
    const tampered = original.map((v, i) => (i >= 28 && i < 35 ? v + 50 : v))
    for (const m of MODELS) {
      assert.deepEqual(m.predict(original.slice(0, 28), 7), m.predict(tampered.slice(0, 28), 7), m.name)
    }
  })

  it('every model call receives only a prefix that ends before the period being predicted', () => {
    const series = shiftSeries()
    const calls: { history: number[]; horizon: number }[] = []
    const originals = MODELS.map((m) => m.predict)
    MODELS.forEach((m, i) => {
      m.predict = (history, horizon) => {
        calls.push({ history: [...history], horizon })
        return originals[i].call(m, history, horizon)
      }
    })
    try {
      runBacktest(new Map([['p', series]]), plan42)
    } finally {
      MODELS.forEach((m, i) => (m.predict = originals[i]))
    }

    assert.ok(calls.length > 0)
    for (const { history, horizon } of calls) {
      // selection calls see exactly the train days; test calls see train + validation, never the test days
      assert.ok(history.length === 28 || history.length === 35, `unexpected history length ${history.length}`)
      assert.deepEqual(history, series.slice(0, history.length))
      assert.equal(horizon, 7)
    }
    assert.ok(calls.every((c) => c.history.length <= 35), 'a model saw test days')
  })

  it('model selection sees ONLY the train days: exact history lengths and call counts', () => {
    const series = shiftSeries()
    const seen: number[] = []
    const originals = MODELS.map((m) => m.predict)
    MODELS.forEach((m, i) => {
      m.predict = (history, horizon) => {
        seen.push(history.length)
        return originals[i].call(m, history, horizon)
      }
    })
    try {
      runBacktest(new Map([['p', series]]), plan42)
    } finally {
      MODELS.forEach((m, i) => (m.predict = originals[i]))
    }
    // selection: every model fitted on the 28 train days (validation values are never passed in);
    // test scoring: only the selected model and the baseline, fitted on train + validation (35 days).
    assert.equal(seen.filter((n) => n === 28).length, MODELS.length)
    assert.equal(seen.filter((n) => n === 35).length, 2)
    assert.equal(seen.length, MODELS.length + 2)
  })

  it('selection is scored against validation values it never saw', () => {
    // Train is flat at 2; validation jumps to 50. If selection could see validation, a recency-aware
    // model would look perfect. Fitted on train only, every model predicts 2 and errs by 48 per day.
    const series = [...repeat(2, 28), ...repeat(50, 7), ...repeat(50, 7)]
    const result = runBacktest(new Map([['p', series]]), plan42)
    for (const s of result.modelSelection) assert.equal(s.validationMae, 48, s.model)
  })

  it('pipeline: changing the last 7 days does not change the split or the selected model', () => {
    const dates = dateRange('2026-01-01', '2026-02-11') // 42 days
    const mk = (tail: number) =>
      dates.map((date, i) => ({ productId: 'p', quantity: i < 35 ? (i < 14 ? 2 : 10) : tail, date }))
    const products = [{ id: 'p', name: 'Test product', category: 'Test' }]
    const a = runForecastPipeline({ products, sales: mk(10) })
    const b = runForecastPipeline({ products, sales: mk(60) })
    assert.deepEqual(a.split, b.split)
    assert.equal(a.selectedModel.name, b.selectedModel.name)
    assert.deepEqual(a.modelSelection, b.modelSelection)
  })
})

describe('forecast pipeline', () => {
  const products = [
    { id: 'fast', name: 'Fast item', category: 'Test' },
    { id: 'none', name: 'Never sold', category: 'Test' },
  ]
  const salesFor = (days: number) =>
    dateRange('2026-01-01', addDays('2026-01-01', days - 1)).map((date, i) => ({
      productId: 'fast',
      quantity: 4 + (i % 3),
      date,
    }))

  it('validates on a chronological split of 42 days', () => {
    const f = runForecastPipeline({ products, sales: salesFor(42), horizonDays: 7 })
    assert.deepEqual(f.historyPeriod, { startDate: '2026-01-01', endDate: '2026-02-11', days: 42 })
    assert.deepEqual(f.split!.train, { startDate: '2026-01-01', endDate: '2026-01-28', days: 28 })
    assert.deepEqual(f.split!.validation, { startDate: '2026-01-29', endDate: '2026-02-04', days: 7 })
    assert.deepEqual(f.split!.test, { startDate: '2026-02-05', endDate: '2026-02-11', days: 7 })
    assert.ok(f.accuracy)
    assert.equal(f.baselineModel, 'historical-mean')
  })

  it('exposes actual vs predicted for the held-out days only', () => {
    const f = runForecastPipeline({ products, sales: salesFor(42) })
    const fast = f.products.find((p) => p.productId === 'fast')!
    assert.deepEqual(fast.testWindow.map((t) => t.date), dateRange('2026-02-05', '2026-02-11'))
    assert.ok(fast.testWindow.every((t) => t.actual >= 4 && t.actual <= 6))
  })

  it('a product that never sold has no demand and is flagged, not guessed', () => {
    const f = runForecastPipeline({ products, sales: salesFor(42) })
    const none = f.products.find((p) => p.productId === 'none')!
    assert.equal(none.predictedDemand, 0)
    assert.equal(none.dataStatus, 'No Sales')
  })

  it('too little history: uses the baseline and claims no accuracy', () => {
    const f = runForecastPipeline({ products, sales: salesFor(12) })
    assert.equal(f.split, null)
    assert.equal(f.accuracy, null)
    assert.equal(f.selectedModel.name, 'historical-mean')
    assert.ok(f.products.every((p) => p.test === null && p.testWindow.length === 0))
  })

  it('no sales at all: empty history, zero forecasts', () => {
    const f = runForecastPipeline({ products, sales: [] })
    assert.equal(f.historyPeriod, null)
    assert.equal(f.split, null)
    assert.ok(f.products.every((p) => p.predictedDemand === 0 && p.dataStatus === 'No Sales'))
  })

  it('average daily demand = units / days in history; predicted demand scales with the horizon', () => {
    const sales = salesFor(42)
    const units = sales.reduce((s, x) => s + x.quantity, 0)
    const seven = runForecastPipeline({ products, sales, horizonDays: 7 }).products[0]
    const fourteen = runForecastPipeline({ products, sales, horizonDays: 14 }).products[0]
    assert.equal(seven.averageDailyDemand, Math.round((units / 42) * 100) / 100)
    assert.ok(Math.abs(fourteen.predictedDemand - seven.predictedDemand * 2) <= 0.02)
  })

  it('is deterministic', () => {
    const a = runForecastPipeline({ products, sales: salesFor(42) })
    const b = runForecastPipeline({ products, sales: salesFor(42) })
    assert.deepEqual(a, b)
  })

  it('always states its limitation', () => {
    assert.match(runForecastPipeline({ products, sales: salesFor(42) }).limitation, /not modelled/)
  })
})

describe('data quality of the history', () => {
  const history = { startDate: '2026-01-01', endDate: '2026-01-20', days: 20 }

  it('no warning when sales are recorded on (nearly) every day', () => {
    const q = assessDataQuality(dateRange('2026-01-01', '2026-01-20'), history)
    assert.equal(q.warning, null)
    assert.equal(q.daysWithoutAnySales, 0)
    assert.equal(q.longestGapDays, 0)
  })

  it('warns when a long stretch has no sales, because missing days count as zero demand', () => {
    const dates = ['2026-01-01', ...dateRange('2026-01-15', '2026-01-20')]
    const q = assessDataQuality(dates, history)
    assert.equal(q.daysWithSales, 7)
    assert.equal(q.daysWithoutAnySales, 13)
    assert.equal(q.longestGapDays, 13)
    assert.match(q.warning!, /13 of 20 days have no recorded sales/)
    assert.match(q.warning!, /too low/)
  })

  it('the pipeline reports it', () => {
    const sales = [
      { productId: 'p', quantity: 5, date: '2026-01-01' },
      ...dateRange('2026-01-20', '2026-02-11').map((date) => ({ productId: 'p', quantity: 5, date })),
    ]
    const f = runForecastPipeline({ products: [{ id: 'p', name: 'P', category: 'T' }], sales })
    assert.ok(f.dataQuality!.warning)
    assert.equal(f.dataQuality!.longestGapDays, 18)
  })
})
