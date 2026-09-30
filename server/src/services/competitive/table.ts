import { parseCsv } from '../external/csv'
import type { Rejection, ValidationReport } from './types'

/** A CSV as records keyed by header, with the 1-based line each record came from. */
export interface CsvTable {
  headers: string[]
  rows: { line: number; cells: Record<string, string> }[]
}

export type TableResult = { ok: true; table: CsvTable } | { ok: false; reason: string }

/**
 * Reads CSV text into records. Header names are matched exactly (ignoring case and surrounding
 * spaces), never by position. Missing required columns reject the whole file with a clear message.
 */
export function readTable(text: string, required: string[]): TableResult {
  const raw = parseCsv(text)
  if (raw.length === 0) return { ok: false, reason: 'The file is empty.' }
  const headers = raw[0].map((h) => h.trim())
  const lower = headers.map((h) => h.toLowerCase())
  const missing = required.filter((r) => !lower.includes(r.toLowerCase()))
  if (missing.length > 0) {
    return { ok: false, reason: `Required column(s) not found: ${missing.join(', ')}. Found: ${headers.join(', ')}.` }
  }
  const rows = raw.slice(1).map((cells, i) => {
    const record: Record<string, string> = {}
    headers.forEach((h, c) => (record[h.toLowerCase()] = (cells[c] ?? '').trim()))
    return { line: i + 2, cells: record }
  })
  return { ok: true, table: { headers, rows } }
}

/** Collects why rows were rejected or flagged, so nothing is dropped silently. */
export class ReportBuilder {
  private rejections = new Map<string, Rejection>()
  private warnings = new Map<string, number>()
  totalRows = 0
  validRows = 0
  templateRows = 0
  constructor(private readonly sourceFile: string) {}

  reject(reason: string, line: number) {
    const r = this.rejections.get(reason) ?? { reason, count: 0, exampleRows: [] }
    r.count++
    if (r.exampleRows.length < 5) r.exampleRows.push(line)
    this.rejections.set(reason, r)
  }

  warn(message: string, count = 1) {
    this.warnings.set(message, (this.warnings.get(message) ?? 0) + count)
  }

  build(): ValidationReport {
    const rejections = [...this.rejections.values()].sort((a, b) => b.count - a.count)
    return {
      sourceFile: this.sourceFile,
      totalRows: this.totalRows,
      validRows: this.validRows,
      rejectedRows: rejections.reduce((s, r) => s + r.count, 0),
      templateRows: this.templateRows,
      rejections,
      warnings: [...this.warnings].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    }
  }
}

/** A plain decimal number, or null for blank / non-numeric text. Thousands separators are not accepted. */
export function toNumber(text: string): number | null {
  if (text === '') return null
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN
}
