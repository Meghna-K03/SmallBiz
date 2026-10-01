---
name: demand-forecasting
description: Work on the SmallBiz Lens forecasting pipeline (server/src/services/forecasting/) without breaking temporal validation. Use when adding or changing a forecast model, the train/validation/test split, the metrics, or anything that feeds restocking or priority from a forecast.
---

# Demand forecasting

Pipeline: zero-filled daily series → chronological split → model selection on **train** → accuracy on **test** → refit on all history → next-N-day forecast.

```
|---- train ----|-- validation --|---- test ----|
```

## Non-negotiable rules

1. **Never shuffle** time-series data.
2. A prediction for a period may only receive data that ends **before** that period. Selection sees train only; test scoring fits on train + validation only. Only the final real forecast uses everything.
3. The selected model must not depend on test values. `test/forecasting.test.ts` ("no temporal leakage") proves this; keep those tests passing and extend them for any new model.
4. Lightweight models only: historical mean (the **baseline**), 7-day moving average, simple exponential smoothing. No LSTM, transformers or RL.
5. Report **MAE and WAPE** for the selected model and the baseline. WAPE is `null` (not NaN) when nothing sold.
6. With less than 21 days of history, use the baseline and claim no accuracy.
7. Missing days are zeros. If the history has large gaps, `dataQuality.warning` must reach the user.
8. Keep `/api/analytics/forecast` (baseline) compatible; new behaviour goes in `/forecast/validated`.

## Adding a model

Add it to `MODELS` in `models.ts` (after the baseline so ties keep the simpler model), as a pure function of `history`. Add: a unit test of its output, and rerun the leakage tests. Run `cd server && npm run verify:forecast` on the real data and read the split, selection and accuracy lines.

## Honesty

Forecasts are estimates from past sales only. Do not describe them as guarantees, and report daily-level error even when it is high.
