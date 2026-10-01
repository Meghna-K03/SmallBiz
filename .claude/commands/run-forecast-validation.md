---
description: Validate the demand forecast on the real sales data (temporal split, leakage check, baseline comparison, MAE, WAPE)
allowed-tools: Bash(npm run verify:forecast:*), Bash(npm run test:pure:*), Bash(npm run -s verify:forecast), Bash(npm run -s test:pure)
---

Validate the forecasting pipeline. Use the `demand-forecasting` skill.

1. Run `cd server && npm run verify:forecast`. It loads the real sales read-only, prints the train / validation / test periods, each model's validation error, the selected model, test-window MAE and WAPE for the selected model and the baseline, the next-7-day forecast per product, and runs live leakage checks (rewriting test-window sales must not change model selection).
2. Run `cd server && npm run test:pure` for the leakage unit tests (the "no temporal leakage" suite).
3. Report: the three periods (and that they are chronological with no overlap), the selected model, MAE and WAPE vs the baseline, every PASS/FAIL check, and the data-quality warning if the history has long gaps.
4. State the limitation honestly: daily WAPE is high when daily sales are sparse, and the forecast is an estimate from past sales only.

If any check fails, treat it as a leakage or correctness bug: find and fix the cause before reporting.
