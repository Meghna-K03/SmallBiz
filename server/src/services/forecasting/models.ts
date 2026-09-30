/**
 * Lightweight, explainable demand models (pure functions, no database).
 *
 * Each model looks ONLY at the history it is given and returns a forecast for the
 * next `horizon` days. A model can never see later data: the caller decides what
 * slice to pass, and backtest.ts only ever passes data that precedes the period
 * being predicted.
 *
 *   historical-mean        the baseline: average units per day over the whole history it is given
 *   moving-average         average of the most recent 7 days
 *   exponential-smoothing  simple exponential smoothing: recent days weigh more; the smoothing
 *                          weight (alpha) is chosen from a fixed list by one-step-ahead error on
 *                          the given history only
 *
 * All three produce a flat daily rate (no trend or weekly pattern), which keeps them easy to explain.
 */

export type ModelName = 'historical-mean' | 'moving-average' | 'exponential-smoothing'

export interface ForecastModel {
  name: ModelName
  label: string
  description: string
  /** Forecast for each of the next `horizon` days, using only `history`. */
  predict(history: readonly number[], horizon: number): number[]
}

export const BASELINE_MODEL: ModelName = 'historical-mean'
export const MOVING_AVERAGE_WINDOW = 7
export const SMOOTHING_ALPHAS = [0.1, 0.2, 0.3, 0.5] as const

const flat = (value: number, horizon: number) => Array.from({ length: horizon }, () => value)
const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

/** Level after smoothing every value of `xs` with weight `alpha`, plus the total one-step-ahead absolute error. */
function smooth(xs: readonly number[], alpha: number) {
  if (xs.length === 0) return { level: 0, oneStepError: 0 }
  let level = xs[0]
  let error = 0
  for (let i = 1; i < xs.length; i++) {
    error += Math.abs(xs[i] - level) // xs[i] is predicted from a level built only from xs[0..i-1]
    level = alpha * xs[i] + (1 - alpha) * level
  }
  return { level, oneStepError: error }
}

/** The alpha with the smallest one-step-ahead error on `history` (the first one wins ties). */
export function chooseAlpha(history: readonly number[]): number {
  let best: number = SMOOTHING_ALPHAS[0]
  let bestError = Infinity
  for (const alpha of SMOOTHING_ALPHAS) {
    const { oneStepError } = smooth(history, alpha)
    if (oneStepError < bestError) {
      best = alpha
      bestError = oneStepError
    }
  }
  return best
}

/** Ordered simplest-first: the baseline is first, so ties in model selection keep the simpler model. */
export const MODELS: ForecastModel[] = [
  {
    name: 'historical-mean',
    label: 'Historical average (baseline)',
    description: 'Average units sold per day over all past days.',
    predict: (history, horizon) => flat(mean(history), horizon),
  },
  {
    name: 'moving-average',
    label: 'Moving average',
    description: `Average units sold per day over the most recent ${MOVING_AVERAGE_WINDOW} days.`,
    predict: (history, horizon) => flat(mean(history.slice(-MOVING_AVERAGE_WINDOW)), horizon),
  },
  {
    name: 'exponential-smoothing',
    label: 'Exponential smoothing',
    description: 'Weighted average of past days where recent days count more.',
    predict: (history, horizon) => flat(smooth(history, chooseAlpha(history)).level, horizon),
  },
]

export const getModel = (name: ModelName): ForecastModel => MODELS.find((m) => m.name === name)!
