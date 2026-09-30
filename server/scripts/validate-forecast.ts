// Read-only forecast validation against the shop's real recorded sales.
// Prints the temporal split, model selection, test-window MAE/WAPE vs the baseline, and
// runs a live leakage check: rewriting the test days must not change model selection.
// Writes nothing. Exits with code 1 if a check fails.
// Usage: npm run verify:forecast
import { prisma } from '../src/lib/prisma'
import { prismaBusinessSource } from '../src/services/dataSource'
import { runForecastPipeline } from '../src/services/forecasting'
import { addDays } from '../src/services/forecasting/series'

const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`)
const failures: string[] = []
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

async function main() {
  const source = prismaBusinessSource()
  const [products, sales] = await Promise.all([source.getProducts(), source.getSales()])
  const f = runForecastPipeline({ products, sales, horizonDays: 7 })

  console.log(`Data: ${sales.length} sales, ${products.length} products (business data only)`)
  if (!f.historyPeriod || !f.split || !f.accuracy) {
    console.log(`History: ${f.historyPeriod ? `${f.historyPeriod.days} days` : 'none'}; too short to validate (needs ${f.reliability.minBacktestDays}+ days).`)
    check(false, 'enough history to run a temporal validation')
    return
  }
  const { train, validation, test } = f.split
  console.log(`History    ${f.historyPeriod.startDate} .. ${f.historyPeriod.endDate} (${f.historyPeriod.days} days)`)
  console.log(`Train      ${train.startDate} .. ${train.endDate} (${train.days} days)`)
  console.log(`Validation ${validation.startDate} .. ${validation.endDate} (${validation.days} days)`)
  console.log(`Test       ${test.startDate} .. ${test.endDate} (${test.days} days)`)
  console.log('\nModel selection (validation error, fitted on train only):')
  for (const m of f.modelSelection) console.log(`  ${m.label.padEnd(32)} MAE ${m.validationMae}  WAPE ${pct(m.validationWape)}`)
  console.log(`Selected: ${f.selectedModel.label}`)
  console.log('\nTest-window accuracy (fitted on train + validation only):')
  console.log(`  Selected  MAE ${f.accuracy.selected.mae}  WAPE ${pct(f.accuracy.selected.wape)}`)
  console.log(`  Baseline  MAE ${f.accuracy.baseline.mae}  WAPE ${pct(f.accuracy.baseline.wape)}`)
  console.log(`  MAE improvement vs baseline: ${pct(f.accuracy.maeImprovementVsBaseline)}`)
  console.log('\nNext 7 days (selected model refitted on all history):')
  for (const p of [...f.products].sort((a, b) => b.predictedDemand - a.predictedDemand)) {
    console.log(`  ${p.productName.padEnd(28)} ≈ ${String(p.predictedDemand).padStart(7)}  avg/day ${p.averageDailyDemand}  [${p.dataStatus}]`)
  }

  console.log('\nChecks:')
  check(train.days + validation.days + test.days === f.historyPeriod.days, 'train + validation + test cover the history exactly')
  check(train.endDate < validation.startDate && validation.endDate < test.startDate, 'periods are in chronological order, no overlap')
  check(test.endDate === f.historyPeriod.endDate, 'test window is the most recent data')

  // Live leakage check: rewrite ONLY the sales dated in the test window and re-run.
  const tampered = sales.map((s) => (s.date >= test.startDate ? { ...s, quantity: s.quantity * 9 + 5 } : s))
  const g = runForecastPipeline({ products, sales: tampered, horizonDays: 7 })
  check(g.selectedModel.name === f.selectedModel.name, 'rewriting test-window sales does not change the selected model')
  check(JSON.stringify(g.modelSelection) === JSON.stringify(f.modelSelection), 'rewriting test-window sales does not change validation scores')
  check(JSON.stringify(g.split) === JSON.stringify(f.split), 'rewriting test-window sales does not change the split')
  check(g.accuracy?.selected.mae !== f.accuracy.selected.mae, 'test error DOES respond to test data (the test window is really scored)')
  check(addDays(test.startDate, test.days - 1) === test.endDate, 'test window length matches its dates')
}

main()
  .catch((e) => {
    console.error('validate-forecast failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    if (failures.length > 0) process.exitCode = 1
  })
