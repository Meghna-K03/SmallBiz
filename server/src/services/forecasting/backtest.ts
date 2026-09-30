import { BASELINE_MODEL, getModel, MODELS, type ModelName } from './models'

/**
 * Temporal validation (pure, no database). Time-series data is never shuffled.
 *
 *   |---- train ----|-- validation --|---- test ----|
 *   oldest                                     newest
 *
 *   1. Model selection: each model is fitted on TRAIN only and predicts the VALIDATION
 *      days. The model with the smallest pooled error is selected. TEST is not read.
 *   2. Honest accuracy: the selected model and the baseline are refitted on
 *      TRAIN + VALIDATION only and predict the TEST days (the most recent days).
 *      MAE and WAPE are computed from these test predictions.
 *   3. (index.ts) The selected model is refitted on ALL history for the real forecast.
 *
 * Leakage rule: a prediction for a period only ever receives a slice of the series that
 * ends before that period. Changing test values can change the reported test error but
 * can never change which model is selected or what it predicts.
 */

export const TEST_DAYS = 7
export const VALIDATION_DAYS = 7
export const MIN_TRAIN_DAYS = 7
/** Shortest history for which a train / validation / test split is possible. */
export const MIN_BACKTEST_DAYS = TEST_DAYS + VALIDATION_DAYS + MIN_TRAIN_DAYS

export interface SplitPlan {
  trainDays: number
  validationDays: number
  testDays: number
}

/** Chronological split of `totalDays`, or null when the history is too short to validate. */
export function planSplit(totalDays: number): SplitPlan | null {
  if (totalDays < MIN_BACKTEST_DAYS) return null
  return {
    trainDays: totalDays - VALIDATION_DAYS - TEST_DAYS,
    validationDays: VALIDATION_DAYS,
    testDays: TEST_DAYS,
  }
}

export interface Metrics {
  /** Mean absolute error in units per day. */
  mae: number | null
  /** Weighted absolute percentage error = sum|actual - predicted| / sum(actual). Null when nothing was sold. */
  wape: number | null
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

export const sumAbsError = (actual: readonly number[], predicted: readonly number[]) =>
  actual.reduce((sum, a, i) => sum + Math.abs(a - predicted[i]), 0)

export function mae(actual: readonly number[], predicted: readonly number[]): number | null {
  return actual.length === 0 ? null : round4(sumAbsError(actual, predicted) / actual.length)
}

export function wape(actual: readonly number[], predicted: readonly number[]): number | null {
  const total = actual.reduce((a, b) => a + b, 0)
  return total <= 0 ? null : round4(sumAbsError(actual, predicted) / total)
}

export const metrics = (actual: readonly number[], predicted: readonly number[]): Metrics => ({
  mae: mae(actual, predicted),
  wape: wape(actual, predicted),
})

export interface ModelValidationScore {
  model: ModelName
  validationMae: number | null
  validationWape: number | null
}

export interface ProductBacktest {
  /** Test-window predictions, refitted on train + validation only. */
  selected: { predicted: number[]; metrics: Metrics }
  baseline: { predicted: number[]; metrics: Metrics }
  actual: number[]
}

export interface BacktestResult {
  plan: SplitPlan
  selectedModel: ModelName
  modelSelection: ModelValidationScore[]
  products: Map<string, ProductBacktest>
  pooled: { selected: Metrics; baseline: Metrics }
}

/**
 * Runs the temporal validation for many products. `seriesByProduct` holds one
 * zero-filled daily series per product, all exactly `plan` days long in total.
 */
export function runBacktest(seriesByProduct: Map<string, number[]>, plan: SplitPlan): BacktestResult {
  const trainEnd = plan.trainDays
  const valEnd = plan.trainDays + plan.validationDays
  const entries = [...seriesByProduct.entries()]

  // Step 1: model selection. Only the train slice is passed in; only validation values are compared.
  const scores = MODELS.map((model) => {
    let error = 0
    let actualSum = 0
    let n = 0
    for (const [, series] of entries) {
      const predicted = model.predict(series.slice(0, trainEnd), plan.validationDays)
      const actual = series.slice(trainEnd, valEnd)
      error += sumAbsError(actual, predicted)
      actualSum += actual.reduce((a, b) => a + b, 0)
      n += actual.length
    }
    return {
      model: model.name,
      error,
      validationMae: n === 0 ? null : round4(error / n),
      validationWape: actualSum <= 0 ? null : round4(error / actualSum),
    }
  })
  // Smallest pooled validation error wins; MODELS is ordered baseline-first so a tie keeps the simpler model.
  const best = scores.reduce((a, b) => (b.error < a.error ? b : a))
  const selectedModel = best.model

  // Step 2: test accuracy. Fit on train + validation only; the test slice is used for scoring alone.
  const selected = getModel(selectedModel)
  const baseline = getModel(BASELINE_MODEL)
  const products = new Map<string, ProductBacktest>()
  const pooledActual: number[] = []
  const pooledSelected: number[] = []
  const pooledBaseline: number[] = []
  for (const [productId, series] of entries) {
    const known = series.slice(0, valEnd)
    const actual = series.slice(valEnd, valEnd + plan.testDays)
    const s = selected.predict(known, plan.testDays)
    const b = baseline.predict(known, plan.testDays)
    products.set(productId, {
      selected: { predicted: s, metrics: metrics(actual, s) },
      baseline: { predicted: b, metrics: metrics(actual, b) },
      actual,
    })
    pooledActual.push(...actual)
    pooledSelected.push(...s)
    pooledBaseline.push(...b)
  }

  return {
    plan,
    selectedModel,
    modelSelection: scores.map(({ model, validationMae, validationWape }) => ({ model, validationMae, validationWape })),
    products,
    pooled: { selected: metrics(pooledActual, pooledSelected), baseline: metrics(pooledActual, pooledBaseline) },
  }
}
