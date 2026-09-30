# External Indian market data (optional)

SmallBiz Lens can show **official Indian retail-price context** next to the shop's own data.
It never mixes it with the shop's sales, and it never changes a forecast.

No data ships with the project. Until you import a file, the dashboard says
"No official data file imported" and shows no market figures.

## What to import

Retail price data from the Government of India's Open Government Data platform,
published by the **Department of Consumer Affairs (Price Monitoring Cell)**:

- Catalog group: <https://www.data.gov.in/dataset-group-name/Essential%20Commodities>
- Example dataset page: <https://www.data.gov.in/catalog/dailyweekly-retail-prices-milk>

The portal footer says content is licensed under the Government Open Data License - India
(GODL-India), and the Milk dataset page says it is released under NDSAP. Read the terms shown
for the specific file you download.

**What was checked (2026-09-30):** the Milk dataset page above lists the publisher, 75 market
centres, and published/updated 21/09/2015, but showed no downloadable resource. `api.data.gov.in`
was unreachable from the development machine, so no records or column names were obtained.
Other commodity datasets were not opened.

## How

1. Obtain a **retail-price** CSV from the official portal yourself. It is not verified which
   exports or API access the portal currently offers. Automated downloading is intentionally
   not built in.
2. Save it as `server/data/external/india-retail-prices.csv`
   (or set `EXTERNAL_PRICES_CSV` in `server/.env` to another path).
3. Optional but recommended: create `server/data/external/india-retail-prices.csv.provenance.json`:

   ```json
   { "retrievalDate": "YYYY-MM-DD", "datasetTitle": "exact title from the portal", "datasetUrl": "https://www.data.gov.in/catalog/..." }
   ```
4. Restart the server and open the dashboard, or call `GET /api/external/market-prices`.

## Column requirements

Columns are matched by **name** (case-insensitive), not position:

| Meaning   | Accepted column names                                                    | Required |
|-----------|--------------------------------------------------------------------------|----------|
| commodity | commodity, commodity_name, item, item_name                               | yes      |
| date      | date, price_date, reported_date, reporting_date, arrival_date            | yes      |
| price     | retail_price, price, avg_price, average_price, price_per_unit            | yes      |
| market    | market, market_name, centre, center, market_centre                       | no       |
| state     | state, state_name                                                        | no       |

Dates may be `YYYY-MM-DD` or `DD/MM/YYYY`. If a required column is missing the file is rejected
with a message that lists the columns it found. Rows with a missing value, invalid date or
non-positive price are dropped and counted; the counts appear in the provenance panel.
Make sure the file holds **retail** prices, not wholesale/mandi prices.
