// Read-only data-quality report for BOTH data kinds, kept separate:
//   1. Business data (the shop's own sales, products, purchases)
//   2. External Indian market data (official retail prices), if an export was imported
// Writes nothing. Usage: npm run analyze:data
import { prisma } from '../src/lib/prisma'
import { prismaBusinessSource } from '../src/services/dataSource'
import { dateRange } from '../src/services/forecasting/series'
import { indiaRetailPrices } from '../src/services/external/indiaRetailPrices'
import { buildCompetitiveResponse, getCompetitiveDataset } from '../src/services/competitive'

async function business() {
  console.log('=== BUSINESS DATA (Sharma General Store, application database) ===')
  const source = prismaBusinessSource()
  const [products, sales, purchases, expenses, full] = await Promise.all([
    source.getProducts(),
    source.getSales(),
    prisma.purchase.count(),
    prisma.expense.count(),
    prisma.product.findMany({ select: { id: true, name: true, sellingPrice: true, purchasePrice: true, minStockLevel: true } }),
  ])
  console.log(`Products ${products.length} | sales rows ${sales.length} | purchases ${purchases} | expenses ${expenses}`)

  const dates = [...new Set(sales.map((s) => s.date))].sort()
  if (dates.length === 0) return console.log('No sales recorded: nothing to analyse.')
  const span = dateRange(dates[0], dates[dates.length - 1])
  const missingDays = span.filter((d) => !dates.includes(d))
  console.log(`Date range ${dates[0]} .. ${dates[dates.length - 1]} (${span.length} days, ${dates.length} with sales, ${missingDays.length} without)`)
  if (missingDays.length > 0) console.log(`  Days with no sales: ${missingDays.join(', ')}`)

  const units = new Map<string, number>()
  for (const s of sales) units.set(s.productId, (units.get(s.productId) ?? 0) + s.quantity)
  console.log('Coverage per product (units sold / days with a sale):')
  for (const p of products) {
    const daysWithSale = new Set(sales.filter((s) => s.productId === p.id).map((s) => s.date)).size
    console.log(`  ${p.name.padEnd(30)} ${String(units.get(p.id) ?? 0).padStart(5)} units, ${String(daysWithSale).padStart(2)} sale days${daysWithSale < 3 ? '  <- too little history to trust' : ''}`)
  }

  const nameCounts = new Map<string, number>()
  for (const p of products) nameCounts.set(p.name.toLowerCase(), (nameCounts.get(p.name.toLowerCase()) ?? 0) + 1)
  const dupes = [...nameCounts].filter(([, n]) => n > 1)
  if (dupes.length > 0) console.log(`Duplicate product names (forecasts are per product id, so they stay separate): ${dupes.map(([n, c]) => `${n} x${c}`).join(', ')}`)
  const badPrice = full.filter((p) => Number(p.sellingPrice) <= 0 || Number(p.purchasePrice) <= 0)
  console.log(`Products with a zero/negative price: ${badPrice.length}`)
  const negativeMargin = full.filter((p) => Number(p.sellingPrice) < Number(p.purchasePrice))
  console.log(`Products sold below purchase price: ${negativeMargin.length}${negativeMargin.length ? ` (${negativeMargin.map((p) => p.name).join(', ')})` : ''}`)
  console.log('Useful signals: daily unit series per product (forecasting), stock vs minimum level (priority), purchase price (inventory value).')
  console.log('Limitations: single store, a few weeks of history, no promotions/festival/weather information.')
}

async function external() {
  console.log('\n=== EXTERNAL INDIAN MARKET DATA (never mixed with business data) ===')
  const [status, provenance, report, summary] = await Promise.all([
    indiaRetailPrices.getStatus(),
    indiaRetailPrices.getProvenance(),
    indiaRetailPrices.getImportReport(),
    indiaRetailPrices.getSummary(),
  ])
  console.log(`Source     ${provenance.sourceName}`)
  console.log(`Publisher  ${provenance.publisher}`)
  console.log(`URL        ${provenance.officialUrl}`)
  console.log(`License    ${provenance.license}`)
  console.log(`Status     ${status.state}${'reason' in status ? ` - ${status.reason}` : ` (${status.observations} observations)`}`)
  if (report) {
    console.log(`Rows read ${report.rowsRead}, kept ${report.rowsKept}, dropped ${JSON.stringify(report.skipped)}`)
    console.log(`Columns    ${JSON.stringify(report.columns)}`)
    console.log(`Period     ${provenance.dataPeriod ? `${provenance.dataPeriod.from} .. ${provenance.dataPeriod.to}` : 'n/a'} | retrieved ${provenance.retrievalDate ?? 'not recorded'}`)
    console.log(`Commodities ${summary.length}: ${summary.slice(0, 15).map((s) => s.commodity).join(', ')}`)
  } else {
    console.log('No official file imported, so there is nothing to analyse. See server/data/external/README.md.')
  }
  console.log('Limitations:')
  for (const l of provenance.limitations) console.log(`  - ${l}`)
}

async function competitive() {
  console.log('\n=== COMPETITIVE PRICE DATA (data_csv/, external, never mixed with business data) ===')
  const ds = await getCompetitiveDataset()
  const r = buildCompetitiveResponse(ds)
  console.log(`Directory  ${ds.directory}`)
  for (const f of r.files) {
    const v = f.validation
    console.log(`${f.file.padEnd(22)} ${f.role.padEnd(12)} provenance ${String(f.provenance).padEnd(10)} ${f.error ?? ''}`)
    if (v) {
      console.log(`  rows ${v.totalRows} | valid ${v.validRows} | rejected ${v.rejectedRows} | template ${v.templateRows}`)
      for (const x of v.rejections) console.log(`  rejected: ${x.reason} x${x.count} (lines ${x.exampleRows.join(', ')})`)
      for (const w of v.warnings) console.log(`  warning:  ${w.message} x${w.count}`)
    }
  }
  console.log('Platform coverage (platform / file / provenance / observations / with price / in stock):')
  for (const c of r.platformCoverage) console.log(`  ${c.platform.padEnd(17)} ${c.sourceFile.padEnd(20)} ${c.provenance.padEnd(8)} ${String(c.observations).padStart(5)} ${String(c.withPrice).padStart(5)} ${String(c.inStock).padStart(5)}`)
  console.log(`Verified platforms: ${r.verifiedPlatforms.length ? r.verifiedPlatforms.join(', ') : 'none'}`)
  console.log(`Blinkit: ${r.blinkit.verifiedObservations} verified, ${r.blinkit.sampleObservations} sample. ${r.blinkit.message ?? ''}`)
  if (ds.priceUnit) console.log(`Zepto price unit: ${ds.priceUnit.unit} (${ds.priceUnit.mrpDivisibleBy100}/${ds.priceUnit.mrpValuesChecked} MRPs divisible by 100, median ₹${ds.priceUnit.medianMrpInrIfPaise})`)
  console.log(`Reference basket: ${r.reference.products} products | confirmed ${r.reference.statusCounts.confirmed}, possible ${r.reference.statusCounts.possible}, ambiguous ${r.reference.statusCounts.ambiguous}, unmatched ${r.reference.statusCounts.unmatched}`)
  console.log('Limitations:')
  for (const l of r.limitations) console.log(`  - ${l}`)
}

// `--competitive-only` skips the database-backed sections (the CSV files need no database).
const competitiveOnly = process.argv.includes('--competitive-only')

;(competitiveOnly ? competitive() : business().then(external).then(competitive))
  .catch((e) => {
    console.error('analyze-data failed:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
