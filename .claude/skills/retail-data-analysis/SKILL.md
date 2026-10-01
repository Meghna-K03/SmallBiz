---
name: retail-data-analysis
description: Inspect and judge retail data for SmallBiz Lens (the shop's sales/purchases and the external Indian market source): provenance, date coverage, gaps, coverage per product, duplicates, and whether the data is fit for forecasting. Use before trusting or importing any dataset, or when a forecast looks odd.
---

# Retail data analysis

Two kinds of data exist and must never be merged:

- **Business data**: the shop's own records (Prisma: Product, Sale, Purchase, Expense).
- **External Indian market data**: official public prices, read through `server/src/services/external/`.

## Steps

1. Run `cd server && npm run analyze:data` (read-only). It reports both kinds separately.
2. Business data, check and state plainly:
   - date range, days with sales vs days without, and the longest gap (a gap counts as zero demand in forecasts);
   - products with fewer than 3 sale days (too thin to trust);
   - duplicate names, zero or negative prices, products sold below purchase price.
3. External data, check:
   - `getStatus()` (`not-configured` / `invalid` / `ready`) and the import report (rows kept, dropped by reason);
   - provenance: publisher, official URL, license, retrieval date, data period, columns used, limitations;
   - that the file holds **retail** (not wholesale/mandi) prices.
4. Competitive price data (`data_csv/`, `server/src/services/competitive/`), a third kind, also external and never merged with business data. Check per file: total / valid / rejected / template rows and reasons; what each file really is (a file's `data_source` label is not trusted: an all-blank file labelled COLLECTED is a template; SAMPLE rows stay sample); which platforms have verified observations (none unless rows are labelled COLLECTED and carry values); the Zepto price-unit evidence; match counts. Never derive Blinkit rows from Zepto data or fill a blank.
5. Conclude with what the data can and cannot support. Do not fill gaps or guess a source.

## Rules

- Never invent data. Never present sample or test data as real. No Kaggle, no scraped retailer numbers.
- Never write to the database while analysing. The live database holds the owner's real records.
- If a source cannot be reached or verified, report that instead of substituting another.
- Provenance facts must come from what was actually checked (see `VERIFIED_ON` in `indiaRetailPrices.ts`).
