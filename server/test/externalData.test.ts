// External Indian market data adapter: parsing, validation, provenance, separation from
// business data. The CSV strings below are tiny TEST FIXTURES that exercise the parser;
// they are not real prices and are never shown in the application.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { parseCsv } from '../src/services/external/csv'
import {
  createIndiaRetailPriceSource,
  parseDate,
  parseRetailPriceCsv,
  summarizeCommodities,
} from '../src/services/external/indiaRetailPrices'

describe('csv parser', () => {
  it('handles quotes, embedded commas, doubled quotes, CRLF and a byte-order mark', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2')
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']])
  })

  it('keeps a line break inside quotes', () => {
    assert.deepEqual(parseCsv('a\n"line1\nline2"'), [['a'], ['line1\nline2']])
  })
})

describe('date parsing', () => {
  it('accepts ISO and day-first formats and rejects impossible dates', () => {
    assert.equal(parseDate('2026-03-05'), '2026-03-05')
    assert.equal(parseDate('05/03/2026'), '2026-03-05')
    assert.equal(parseDate('5-3-2026'), '2026-03-05')
    assert.equal(parseDate('31/02/2026'), null)
    assert.equal(parseDate('not a date'), null)
  })
})

const FIXTURE = [
  'State,Market,Commodity,Date,Retail Price',
  'StateA,MarketA,Testium,01/06/2026,10',
  'StateA,MarketA,Testium,02/06/2026,"1,020"', // thousands separator is removed
  'StateA,MarketB,Testium,03/06/2026,-5', // bad price
  'StateA,MarketB,Testium,32/06/2026,12', // bad date
  'StateA,MarketB,,04/06/2026,12', // missing commodity
  'StateB,MarketC,Otherium,04/06/2026,0', // zero price
].join('\n')

describe('parseRetailPriceCsv', () => {
  it('maps columns by name (any order, any case) and reports what was dropped', () => {
    const r = parseRetailPriceCsv(FIXTURE)
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.observations.length, 2)
    assert.deepEqual(r.observations[1], { commodity: 'Testium', date: '2026-06-02', price: 1020, market: 'MarketA', state: 'StateA' })
    assert.deepEqual(r.report.skipped, { missingValue: 1, badPrice: 2, badDate: 1 })
    assert.equal(r.report.rowsRead, 6)
    assert.equal(r.report.rowsKept, 2)
    assert.equal(r.report.columns.price, 'Retail Price')
  })

  it('rejects a file that lacks a required column instead of guessing', () => {
    const r = parseRetailPriceCsv('Name,When,Amount\nx,2026-01-01,5')
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /Required column\(s\) not found: commodity, date, price/)
  })

  it('rejects an empty file and a file with no usable rows', () => {
    assert.equal(parseRetailPriceCsv('').ok, false)
    assert.equal(parseRetailPriceCsv('commodity,date,price\nx,bad,1').ok, false)
  })
})

describe('summarizeCommodities', () => {
  const obs = (commodity: string, date: string, price: number) => ({ commodity, date, price, market: null, state: null })

  it('compares the earliest and latest dates and reports the change', () => {
    const list = [obs('Testium', '2026-01-01', 10), obs('Testium', '2026-01-02', 10), obs('Testium', '2026-01-03', 12), obs('Testium', '2026-01-04', 12)]
    const [s] = summarizeCommodities(list)
    assert.equal(s.earlyAveragePrice, 10) // k = floor(4/2) = 2 dates each side
    assert.equal(s.lateAveragePrice, 12)
    assert.equal(s.changePercent, 20)
    assert.equal(s.observations, 4)
    assert.equal(s.from, '2026-01-01')
    assert.equal(s.to, '2026-01-04')
  })

  it('does not invent a change from a single date', () => {
    const [s] = summarizeCommodities([obs('Testium', '2026-01-01', 10), obs('Testium', '2026-01-01', 14)])
    assert.equal(s.changePercent, null)
    assert.equal(s.earlyAveragePrice, null)
  })

  it('groups commodities case-insensitively and sorts by name', () => {
    const out = summarizeCommodities([obs('milk', '2026-01-01', 1), obs('Milk', '2026-01-02', 1), obs('Atta', '2026-01-01', 1)])
    assert.deepEqual(out.map((s) => s.commodity), ['Atta', 'milk'])
    assert.equal(out[1].observations, 2)
  })
})

describe('source adapter', () => {
  it('with no imported file: reports not-configured, returns no data and invents nothing', async () => {
    const source = createIndiaRetailPriceSource({ filePath: path.join(os.tmpdir(), 'smallbiz-no-such-file.csv') })
    const status = await source.getStatus()
    assert.equal(status.state, 'not-configured')
    assert.deepEqual(await source.getObservations(), [])
    assert.deepEqual(await source.getSummary(), [])
    const p = await source.getProvenance()
    assert.equal(p.dataPeriod, null)
    assert.equal(p.retrievalDate, null)
    assert.deepEqual(p.fields, [])
    assert.match(p.publisher, /Department of Consumer Affairs/)
    assert.match(p.officialUrl, /^https:\/\/www\.data\.gov\.in\//)
    assert.ok(p.limitations.length > 0)
  })

  it('with a valid file: reports ready, provenance shows period, fields and transformations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallbiz-ext-'))
    const file = path.join(dir, 'prices.csv')
    try {
      await fs.writeFile(file, FIXTURE)
      await fs.writeFile(`${file}.provenance.json`, JSON.stringify({ retrievalDate: '2026-09-30', datasetTitle: 'Test fixture' }))
      const source = createIndiaRetailPriceSource({ filePath: file })
      assert.deepEqual(await source.getStatus(), { state: 'ready', observations: 2 })
      const p = await source.getProvenance()
      assert.deepEqual(p.dataPeriod, { from: '2026-06-01', to: '2026-06-02' })
      assert.equal(p.retrievalDate, '2026-09-30')
      assert.equal(p.sourceName, 'Test fixture')
      assert.ok(p.fields.some((f) => f.startsWith('Retail Price')))
      assert.ok(p.transformations.some((t) => /Rows dropped/.test(t)))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('with an invalid file: reports the reason and returns no data', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smallbiz-ext-'))
    const file = path.join(dir, 'bad.csv')
    try {
      await fs.writeFile(file, 'foo,bar\n1,2')
      const source = createIndiaRetailPriceSource({ filePath: file })
      const status = await source.getStatus()
      assert.equal(status.state, 'invalid')
      assert.deepEqual(await source.getObservations(), [])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('is an external-market source, structurally separate from business data', async () => {
    const source = createIndiaRetailPriceSource({ filePath: path.join(os.tmpdir(), 'smallbiz-no-such-file.csv') })
    assert.equal(source.kind, 'external-market')
    assert.equal('getSales' in source, false)
    assert.equal('getProducts' in source, false)
  })
})
