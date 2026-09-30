import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../lib/prisma'
import { prismaBusinessSource, type BusinessDataSource, type BusinessProduct } from '../dataSource'
import { classifyDataStatus, DEFAULT_HORIZON_DAYS, MIN_HISTORY_DAYS, MIN_SALE_RECORDS, type DataStatus } from '../forecast'
import { planSplit, runBacktest, MIN_BACKTEST_DAYS, type Metrics, type ModelValidationScore } from './backtest'
import { BASELINE_MODEL, getModel, MODELS, type ModelName } from './models'
import { addDays, buildDailySeries, dateRange, type SaleLike } from './series'

/**
 * Validated demand forecast (pure pipeline + a thin database loader).
 *
 *   sales history -> zero-filled daily series -> chronological split
 *     -> model selection on TRAIN -> accuracy on TEST (MAE, WAPE, vs baseline)
 *     -> selected model refitted on ALL history -> forecast for the next N days
 *
 * See backtest.ts for the split and the leakage rules, and models.ts for the models.
 * The forecast is an estimate from past sales only; it ignores promotions, festivals,
 * weather and price changes, and is not a guarantee.
 */

type Db = PrismaClient | Prisma.TransactionClient

export interface Period {
  startDate: string
  endDate: string
  days: number
}

export interface TestWindowPoint {
  date: string
  actual: number
  predicted: number
}

export interface ProductValidatedForecast {
  productId: string
  productName: string
  category: string
  historicalUnitsSold: number
  saleRecords: number
  /** Units per day over the whole history. */
  averageDailyDemand: number
  /** Units per day the selected model expects (flat). */
  predictedDailyDemand: number
  forecastHorizonDays: number
  /** Predicted units over the horizon. */
  predictedDemand: number
  model: ModelName
  dataStatus: DataStatus
  /** Error on the held-out test days (null when the history was too short to validate, or nothing sold in the test days). */
  test: { model: Metrics; baseline: Metrics } | null
  /** Held-out test days: what really sold vs what the selected model predicted. Empty when not validated. */
  testWindow: TestWindowPoint[]
}

/** How complete the sales history is. Unrecorded days are treated as zero sales, so gaps lower forecasts. */
export interface DataQuality {
  historyDays: number
  daysWithSales: number
  daysWithoutAnySales: number
  /** Longest run of consecutive days with no sales for any product. */
  longestGapDays: number
  /** Set when gaps are large enough to distort the forecast. */
  warning: string | null
}

export interface ValidatedForecast {
  method: string
  note: string
  historyPeriod: Period | null
  /** Null when the history is shorter than MIN_BACKTEST_DAYS: no validation was possible. */
  split: { train: Period; validation: Period; test: Period } | null
  baselineModel: ModelName
  selectedModel: { name: ModelName; label: string; description: string }
  modelSelection: (ModelValidationScore & { label: string })[]
  /** Pooled error across all products on the test days. Null when not validated. */
  accuracy: {
    selected: Metrics
    baseline: Metrics
    /** (baseline MAE - selected MAE) / baseline MAE. Positive = better than baseline. Null if undefined. */
    maeImprovementVsBaseline: number | null
  } | null
  dataQuality: DataQuality | null
  forecastHorizonDays: number
  reliability: { minBacktestDays: number; minHistoryDays: number; minSaleRecords: number }
  limitation: string
  products: ProductValidatedForecast[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

const LIMITATION =
  'Estimate from past sales only, as a flat daily rate. Trend, weekday patterns, promotions, festivals, ' +
  'weather and price changes are not modelled, and accuracy on a few weeks of history is limited.'

const GAP_SHARE_WARNING = 0.25
const GAP_DAYS_WARNING = 7

export function assessDataQuality(saleDates: string[], history: Period): DataQuality {
  const withSales = new Set(saleDates)
  const days = dateRange(history.startDate, history.endDate)
  let longest = 0
  let run = 0
  for (const d of days) {
    run = withSales.has(d) ? 0 : run + 1
    longest = Math.max(longest, run)
  }
  const without = days.length - days.filter((d) => withSales.has(d)).length
  const noisy = without / days.length >= GAP_SHARE_WARNING || longest >= GAP_DAYS_WARNING
  return {
    historyDays: days.length,
    daysWithSales: days.length - without,
    daysWithoutAnySales: without,
    longestGapDays: longest,
    warning: noisy
      ? `${without} of ${days.length} days have no recorded sales for any product (longest stretch ${longest} days). ` +
        'Missing days count as zero sales; if the shop was open but sales were not recorded, forecasts will be too low.'
      : null,
  }
}

function period(startDate: string, endDate: string): Period {
  return { startDate, endDate, days: dateRange(startDate, endDate).length }
}

export interface PipelineInput {
  products: BusinessProduct[]
  sales: SaleLike[]
  horizonDays?: number
}

/** The whole pipeline on plain data. Deterministic; no database, no AI. */
export function runForecastPipeline(input: PipelineInput): ValidatedForecast {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  const dates = input.sales.map((s) => s.date).sort()
  const history = dates.length === 0 ? null : period(dates[0], dates[dates.length - 1])

  const base = {
    method: 'temporal-validation: historical-mean baseline vs moving-average vs exponential-smoothing',
    note: 'Estimate based on past sales only; not a guarantee.',
    baselineModel: BASELINE_MODEL,
    forecastHorizonDays: horizonDays,
    reliability: { minBacktestDays: MIN_BACKTEST_DAYS, minHistoryDays: MIN_HISTORY_DAYS, minSaleRecords: MIN_SALE_RECORDS },
    limitation: LIMITATION,
  }

  if (!history) {
    return {
      ...base,
      historyPeriod: null,
      split: null,
      selectedModel: describe(BASELINE_MODEL),
      modelSelection: [],
      accuracy: null,
      dataQuality: null,
      products: input.products.map((p) => emptyProduct(p, horizonDays)),
    }
  }

  const seriesByProduct = buildDailySeries(input.sales, history.startDate, history.endDate)
  const zeros = () => new Array<number>(history.days).fill(0)
  const fullSeries = new Map(input.products.map((p) => [p.id, seriesByProduct.get(p.id) ?? zeros()]))
  const records = new Map<string, number>()
  for (const s of input.sales) records.set(s.productId, (records.get(s.productId) ?? 0) + 1)

  // Validation is optional: too little history means the baseline is used and no accuracy is claimed.
  const plan = planSplit(history.days)
  const backtest = plan ? runBacktest(fullSeries, plan) : null
  const selectedName = backtest?.selectedModel ?? BASELINE_MODEL
  const selected = getModel(selectedName)

  let split: ValidatedForecast['split'] = null
  if (plan) {
    const trainEnd = addDays(history.startDate, plan.trainDays - 1)
    const valStart = addDays(trainEnd, 1)
    const valEnd = addDays(trainEnd, plan.validationDays)
    const testStart = addDays(valEnd, 1)
    split = {
      train: period(history.startDate, trainEnd),
      validation: period(valStart, valEnd),
      test: period(testStart, history.endDate),
    }
  }

  const products = input.products.map((p): ProductValidatedForecast => {
    const series = fullSeries.get(p.id)!
    const units = sum(series)
    const saleRecords = records.get(p.id) ?? 0
    const perDay = selected.predict(series, 1)[0]
    const bt = backtest?.products.get(p.id)
    return {
      productId: p.id,
      productName: p.name,
      category: p.category,
      historicalUnitsSold: units,
      saleRecords,
      averageDailyDemand: round2(units / history.days),
      predictedDailyDemand: round2(perDay),
      forecastHorizonDays: horizonDays,
      predictedDemand: round2(sum(selected.predict(series, horizonDays))),
      model: selectedName,
      dataStatus: classifyDataStatus(units, saleRecords, history.days),
      test: bt ? { model: bt.selected.metrics, baseline: bt.baseline.metrics } : null,
      testWindow:
        bt && split
          ? dateRange(split.test.startDate, split.test.endDate).map((date, i) => ({
              date,
              actual: bt.actual[i],
              predicted: round2(bt.selected.predicted[i]),
            }))
          : [],
    }
  })

  const pooled = backtest?.pooled
  const improvement =
    pooled && pooled.baseline.mae && pooled.selected.mae !== null
      ? Math.round(((pooled.baseline.mae - pooled.selected.mae) / pooled.baseline.mae) * 10_000) / 10_000
      : null

  return {
    ...base,
    historyPeriod: history,
    split,
    selectedModel: describe(selectedName),
    modelSelection: (backtest?.modelSelection ?? []).map((s) => ({ ...s, label: getModel(s.model).label })),
    dataQuality: assessDataQuality(dates, history),
    accuracy: pooled ? { selected: pooled.selected, baseline: pooled.baseline, maeImprovementVsBaseline: improvement } : null,
    products,
  }
}

function describe(name: ModelName) {
  const m = MODELS.find((x) => x.name === name)!
  return { name: m.name, label: m.label, description: m.description }
}

function emptyProduct(p: BusinessProduct, horizonDays: number): ProductValidatedForecast {
  return {
    productId: p.id,
    productName: p.name,
    category: p.category,
    historicalUnitsSold: 0,
    saleRecords: 0,
    averageDailyDemand: 0,
    predictedDailyDemand: 0,
    forecastHorizonDays: horizonDays,
    predictedDemand: 0,
    model: BASELINE_MODEL,
    dataStatus: 'No Sales',
    test: null,
    testWindow: [],
  }
}

/** Loads the shop's own data and runs the pipeline. Read-only. */
export async function getValidatedForecast(
  opts: { horizonDays?: number; source?: BusinessDataSource } = {},
  db: Db = defaultPrisma,
): Promise<ValidatedForecast> {
  const source = opts.source ?? prismaBusinessSource(db)
  const [products, sales] = await Promise.all([source.getProducts(), source.getSales()])
  return runForecastPipeline({ products, sales, horizonDays: opts.horizonDays })
}
