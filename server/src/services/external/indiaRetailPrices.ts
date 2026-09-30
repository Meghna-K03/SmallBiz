import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ExternalMarketSource,
  ExternalSourceStatus,
  MarketPriceObservation,
  Provenance,
} from '../dataSource'
import { parseCsv } from './csv'

/**
 * External Indian market data: official retail-price monitoring by the Government of India.
 *
 *   Publisher   Department of Consumer Affairs (Price Monitoring Cell), Ministry of Consumer
 *               Affairs, Food and Public Distribution, via the Open Government Data (OGD)
 *               Platform India, data.gov.in
 *   Datasets    "Daily/weekly Retail prices of <commodity>" (Rice, Wheat, Milk, Onion, ...)
 *
 * This adapter does NOT download anything and contains NO prices. It reads a CSV that a person
 * exported from the official portal and placed at EXTERNAL_PRICES_CSV (default
 * server/data/external/india-retail-prices.csv). Until such a file exists the source reports
 * "not-configured" and the app shows no market figures. Nothing is invented or sampled.
 *
 * The file's columns are matched by name (see COLUMN_ALIASES), never by position. If a required
 * column cannot be found the whole import is rejected with a clear message, rows that cannot be
 * read are dropped and counted, and the counts are reported. This data is never combined with
 * the shop's own sales history.
 */

export const SOURCE_ID = 'india-doca-retail-prices'
export const DEFAULT_FILE = path.join('data', 'external', 'india-retail-prices.csv')

/** Facts checked by hand on the official catalog pages on VERIFIED_ON. Nothing else is claimed. */
const VERIFIED_ON = '2026-09-30'

const COLUMN_ALIASES = {
  commodity: ['commodity', 'commodity_name', 'item', 'item_name'],
  date: ['date', 'price_date', 'reported_date', 'reporting_date', 'arrival_date'],
  price: ['retail_price', 'price', 'avg_price', 'average_price', 'price_per_unit'],
  market: ['market', 'market_name', 'centre', 'center', 'market_centre', 'market_center'],
  state: ['state', 'state_name'],
} as const
type Column = keyof typeof COLUMN_ALIASES
const REQUIRED: Column[] = ['commodity', 'date', 'price']

const normalize = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export interface ImportReport {
  rowsRead: number
  rowsKept: number
  skipped: { missingValue: number; badPrice: number; badDate: number }
  /** Source column name used for each meaning. */
  columns: Partial<Record<Column, string>>
}

export type ParseResult =
  | { ok: true; observations: MarketPriceObservation[]; report: ImportReport }
  | { ok: false; reason: string }

/** dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd -> yyyy-mm-dd, or null if it is not a real calendar date. */
export function parseDate(raw: string): string | null {
  const v = raw.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

/** Validates and converts CSV text into price observations. Pure. */
export function parseRetailPriceCsv(text: string): ParseResult {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, reason: 'The file is empty.' }

  const header = rows[0].map(normalize)
  const columns: Partial<Record<Column, string>> = {}
  const index: Partial<Record<Column, number>> = {}
  for (const key of Object.keys(COLUMN_ALIASES) as Column[]) {
    const i = header.findIndex((h) => (COLUMN_ALIASES[key] as readonly string[]).includes(h))
    if (i >= 0) {
      index[key] = i
      columns[key] = rows[0][i].trim()
    }
  }
  const missing = REQUIRED.filter((k) => index[k] === undefined)
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Required column(s) not found: ${missing.join(', ')}. Expected one of ${missing
        .map((k) => `[${COLUMN_ALIASES[k].join(', ')}]`)
        .join(' and ')}. Found: ${rows[0].map((h) => h.trim()).join(', ')}.`,
    }
  }

  const skipped = { missingValue: 0, badPrice: 0, badDate: 0 }
  const observations: MarketPriceObservation[] = []
  for (const row of rows.slice(1)) {
    const cell = (k: Column) => (index[k] === undefined ? '' : (row[index[k]!] ?? '').trim())
    const commodity = cell('commodity')
    const rawDate = cell('date')
    const rawPrice = cell('price')
    if (!commodity || !rawDate || !rawPrice) {
      skipped.missingValue++
      continue
    }
    const date = parseDate(rawDate)
    if (!date) {
      skipped.badDate++
      continue
    }
    const price = Number(rawPrice.replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) {
      skipped.badPrice++
      continue
    }
    observations.push({ commodity, date, price, market: cell('market') || null, state: cell('state') || null })
  }

  const report: ImportReport = { rowsRead: rows.length - 1, rowsKept: observations.length, skipped, columns }
  if (observations.length === 0) return { ok: false, reason: 'No usable rows: every row was missing a value or had an invalid date or price.' }
  return { ok: true, observations, report }
}

export interface CommodityMarketSignal {
  commodity: string
  observations: number
  distinctDates: number
  from: string
  to: string
  /** Average published price over the earliest dates in the file. */
  earlyAveragePrice: number | null
  /** Average published price over the latest dates in the file. */
  lateAveragePrice: number | null
  /** (late - early) / early, as a percentage. Null when there are fewer than 2 dates. */
  changePercent: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * One row per commodity. Early and late averages use the first / last k distinct dates
 * (k = up to 7, never more than half of the dates) so that a single day cannot dominate.
 */
export function summarizeCommodities(observations: MarketPriceObservation[]): CommodityMarketSignal[] {
  const byCommodity = new Map<string, MarketPriceObservation[]>()
  for (const o of observations) {
    const key = o.commodity.trim().toLowerCase()
    byCommodity.set(key, [...(byCommodity.get(key) ?? []), o])
  }
  return [...byCommodity.values()]
    .map((obs) => {
      const dates = [...new Set(obs.map((o) => o.date))].sort()
      const k = Math.min(7, Math.floor(dates.length / 2))
      const avg = (set: Set<string>) => {
        const xs = obs.filter((o) => set.has(o.date)).map((o) => o.price)
        return xs.reduce((a, b) => a + b, 0) / xs.length
      }
      const early = k > 0 ? avg(new Set(dates.slice(0, k))) : null
      const late = k > 0 ? avg(new Set(dates.slice(-k))) : null
      return {
        commodity: obs[0].commodity,
        observations: obs.length,
        distinctDates: dates.length,
        from: dates[0],
        to: dates[dates.length - 1],
        earlyAveragePrice: early === null ? null : round2(early),
        lateAveragePrice: late === null ? null : round2(late),
        changePercent: early === null || late === null || early === 0 ? null : round2(((late - early) / early) * 100),
      }
    })
    .sort((a, b) => a.commodity.localeCompare(b.commodity))
}

interface Sidecar {
  retrievalDate?: string
  datasetTitle?: string
  datasetUrl?: string
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export function createIndiaRetailPriceSource(opts: { filePath?: string } = {}): ExternalMarketSource & {
  getImportReport(): Promise<ImportReport | null>
  getSummary(): Promise<CommodityMarketSignal[]>
} {
  const filePath = () => path.resolve(opts.filePath ?? process.env.EXTERNAL_PRICES_CSV ?? DEFAULT_FILE)

  async function load(): Promise<{ status: ExternalSourceStatus; parsed?: Extract<ParseResult, { ok: true }> }> {
    let text: string
    try {
      text = await fs.readFile(filePath(), 'utf8')
    } catch {
      return {
        status: {
          state: 'not-configured',
          reason:
            'No official data file has been imported. Download a retail-price export from data.gov.in and place it at ' +
            'server/data/external/india-retail-prices.csv (see server/data/external/README.md).',
        },
      }
    }
    const parsed = parseRetailPriceCsv(text)
    if (!parsed.ok) return { status: { state: 'invalid', reason: parsed.reason } }
    return { status: { state: 'ready', observations: parsed.observations.length }, parsed }
  }

  async function readSidecar(): Promise<Sidecar> {
    try {
      const raw = JSON.parse(await fs.readFile(`${filePath()}.provenance.json`, 'utf8')) as Sidecar
      return raw && typeof raw === 'object' ? raw : {}
    } catch {
      return {}
    }
  }

  return {
    kind: 'external-market',
    id: SOURCE_ID,
    title: 'Retail prices of essential commodities (Government of India)',

    getStatus: async () => (await load()).status,

    async getObservations() {
      return (await load()).parsed?.observations ?? []
    },

    async getImportReport() {
      return (await load()).parsed?.report ?? null
    },

    async getSummary() {
      const parsed = (await load()).parsed
      return parsed ? summarizeCommodities(parsed.observations) : []
    },

    async getProvenance(): Promise<Provenance> {
      const { parsed } = await load()
      const sidecar = await readSidecar()
      const dates = parsed?.observations.map((o) => o.date).sort()
      return {
        sourceName: sidecar.datasetTitle ?? 'Daily/weekly Retail prices of essential commodities',
        publisher:
          'Department of Consumer Affairs (Price Monitoring Cell), Ministry of Consumer Affairs, Food and Public Distribution, Government of India; published on the Open Government Data (OGD) Platform India',
        officialUrl: sidecar.datasetUrl ?? 'https://www.data.gov.in/dataset-group-name/Essential%20Commodities',
        license: 'The data.gov.in page footer says content is licensed under the Government Open Data License - India (GODL-India), and the Milk dataset page says it is released under NDSAP. Not checked per dataset: read the terms shown for the file you import.',
        retrievalDate: isDate(sidecar.retrievalDate) ? sidecar.retrievalDate : null,
        dataPeriod: dates && dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
        fields: parsed ? Object.entries(parsed.report.columns).map(([meaning, column]) => `${column} -> ${meaning}`) : [],
        transformations: parsed
          ? [
              'Columns matched by name, not position.',
              'Dates converted to YYYY-MM-DD; prices read as rupee numbers.',
              `Rows dropped: ${parsed.report.skipped.missingValue} missing a value, ${parsed.report.skipped.badDate} with an invalid date, ${parsed.report.skipped.badPrice} with an invalid price (of ${parsed.report.rowsRead} read).`,
              'No other filtering, smoothing or imputation.',
            ]
          : [],
        limitations: [
          `Checked on ${VERIFIED_ON}: the data.gov.in catalog page for the Milk dataset lists publisher Department of Consumer Affairs (Ministry of Consumer Affairs, Food and Public Distribution), 75 market centres, and published/updated 21/09/2015, but showed no downloadable resource. Other commodity datasets were not opened. api.data.gov.in was unreachable from the development machine, so no records or column names were obtained. The columns and period of a real export must be checked when it is imported.`,
          'Prices are market-level retail prices for commodities. They are not this shop\'s prices or sales and are never added to its sales history.',
          'The item quality or variety can differ between centres; units follow the publisher.',
          'Shown for context only. They do not change any forecast or restocking figure.',
        ],
      }
    },
  }
}

/** The single instance the app uses. Add future sources next to it; nothing else has to change. */
export const indiaRetailPrices = createIndiaRetailPriceSource()
