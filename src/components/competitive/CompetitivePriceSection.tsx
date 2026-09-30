import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { api } from '../../lib/api'
import { formatCurrency } from '../../lib/format'
import type { CompetitivePricesResponse, PlatformComparisonRow } from '../../types/analytics'

/**
 * Market page body: Blinkit and Zepto prices side by side. Both platforms are read from the project's
 * own price file, where each reference product (brand, name and pack size) has one row per platform, so
 * a product is only ever compared with the same product and size. The shop's own products are not
 * involved. Informational only.
 */

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CompetitivePricesResponse }

const INITIAL_ROWS = 10

/** A platform's usable price: in stock with a valid price, otherwise null. */
function priceOn(row: PlatformComparisonRow, platform: string): number | null {
  const p = row.platforms.find((x) => x.platform === platform)
  return p && p.available === true && p.sellingPriceInr !== null ? p.sellingPriceInr : null
}

const label = (r: PlatformComparisonRow) => [r.brand, r.productName, r.packSizeValue !== null ? `${r.packSizeValue}${r.packSizeUnit && r.packSizeUnit !== 'unit' ? ` ${r.packSizeUnit}` : ''}` : null].filter(Boolean).join(' ')

const Th = ({ children, right }: { children?: React.ReactNode; right?: boolean }) => (
  <th className={`py-2 pr-3 text-xs font-medium uppercase tracking-wide text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)

export function CompetitivePriceSection() {
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .getCompetitivePrices()
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch(() => !cancelled && setState({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])

  const set = state.status === 'ready' ? (state.data.platformComparisons.find((c) => c.basis === 'COLLECTED') ?? state.data.platformComparisons.find((c) => c.basis === 'SAMPLE')) : undefined
  const isSample = set?.basis === 'SAMPLE'
  const rows = (set?.comparisons ?? [])
    .filter((r) => priceOn(r, 'Blinkit') !== null && priceOn(r, 'Zepto') !== null)
    .sort((a, b) => label(a).localeCompare(label(b)))

  return (
    <div className="space-y-4">
      <Card
        title="Blinkit vs Zepto"
        action={isSample ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">Sample prices</span> : undefined}
      >
        {state.status === 'loading' && <p className="py-4 text-center text-sm text-slate-500">Loading…</p>}
        {state.status === 'error' && <EmptyState message="The price comparison could not be loaded. Please try again shortly." />}
        {state.status === 'ready' && rows.length === 0 && <EmptyState message="No Blinkit and Zepto prices are available to compare." />}
        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr>
                    <Th>Product</Th>
                    <Th right>Blinkit</Th>
                    <Th right>Zepto</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(showAll ? rows : rows.slice(0, INITIAL_ROWS)).map((r) => (
                    <tr key={r.productId}>
                      <td className="py-3 pr-3 font-medium text-slate-900">{label(r)}</td>
                      <td className="py-3 pr-3 text-right">{formatCurrency(priceOn(r, 'Blinkit')!)}</td>
                      <td className="py-3 pr-3 text-right">{formatCurrency(priceOn(r, 'Zepto')!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > INITIAL_ROWS && (
              <div className="mt-3">
                <Button variant="secondary" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `View all ${rows.length} products`}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <p className="text-xs text-slate-500">
        Prices are not live.{isSample ? ' These are sample values from the provided file, not recorded market prices.' : ''}
      </p>
    </div>
  )
}
