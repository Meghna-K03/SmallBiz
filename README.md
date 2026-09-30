# SmallBiz Lens — Retail Intelligence & Demand Planning

A web app for a small retail shop. It records sales, purchases, stock and expenses, then answers:

> What is happening in my business, what products need attention, and what demand should I expect next?

## Problem and solution

Shop owners see stock and sales numbers but not what to do about them: which products will run out, how much to buy, whether a forecast can be trusted. SmallBiz Lens keeps the numbers deterministic and explainable:

- **Analytics**: revenue, expenses, estimated profit, inventory value, sales trend, top / slow-moving products, average daily sales, estimated days of stock left.
- **Demand forecast (next 7/14/30 days)** with a proper temporal train/validation/test split, MAE and WAPE, and a comparison with a simple baseline.
- **Restock priority** (High / Medium / Low) and a suggested quantity: advisory only, nothing is ordered.
- **AI explanation** (Groq) that explains the calculated numbers and cannot invent any; a deterministic fallback is used if AI is unavailable.

- **Competitive price intelligence**: external market context (prices, discounts, availability) from CSV files in `data_csv/`, validated, normalised and matched conservatively, with its provenance shown. Never mixed with the shop's own numbers.

Screens: a **Sign in / Create account** screen (full-screen background image, password show/hide, a short animated transition after a successful sign-in), then **Overview**, **Inventory** (products, purchases/restocking, per-product insight with a forecast-vs-actual chart), **Sales**, **Expenses** and **Market** (Blinkit vs Zepto prices). Accounts are real but basic: create an account with email, mobile number and password (scrypt-hashed, never stored as plain text); only a registered email and password can sign in. The shop profile panel (shop name in the sidebar) lets the signed-in user **edit** the shop name, description, phone and location (saved in the database) and change their password. The existing shop data endpoints are not yet protected by the sign-in, and there is no email-based password reset.

**Products:** units include g, kg, ml, L, pieces, packs, boxes, bags, bottles, trays and cans. A product with the same name and unit as an existing one (ignoring case and extra spaces) is rejected; different sizes such as "Tata Tea 250g" and "Tata Tea 500g" are separate products. The inventory table shows product, category, stock, selling price, status, sales per day (whole number) and movement.

## Architecture

```
Business data (Postgres/Prisma) → daily series → analytics → forecasting (validated)
   → inventory intelligence (quantity + priority) → AI explanation → UI
External Indian market data (optional file import) ─ kept separate, context only ─→ UI
data_csv/*.csv → validate → normalise → match → calculate → competitive prices ─ separate ─→ UI
```

- Frontend: React 19, Vite, TypeScript, Tailwind 4, Recharts (`src/`).
- Backend: Express 5, TypeScript, Prisma 7, Supabase Postgres, Groq SDK (`server/`).
- Current stock is computed: opening stock + purchases − sales.
- Details and rules: `CLAUDE.md`, `SPEC.md`.

## Setup

Prerequisites: Node.js 20+, a Postgres database (Supabase), optionally a Groq API key.

```bash
# frontend
npm install
cp .env.example .env.local          # VITE_API_URL=http://localhost:5000/api
npm run dev                          # http://localhost:5173

# backend
cd server
npm install
cp .env.example .env                 # fill in the values below
npm run db:generate
npm run db:migrate                   # creates tables (additive; never resets)
npm run dev                          # http://localhost:5000
```

`npm run db:seed` loads demo data but **deletes every row first**. Do not run it on a database holding real records.

### Environment variables

| File | Variable | Purpose |
|---|---|---|
| `.env.local` | `VITE_API_URL` | Backend base URL |
| `server/.env` | `DATABASE_URL`, `DIRECT_URL` | Supabase runtime / migration connections |
| `server/.env` | `PORT` | API port (default 5000) |
| `server/.env` | `GROQ_API_KEY` (optional), `GROQ_MODEL` | AI explanations; without a key the fallback text is used |
| `server/.env` | `EXTERNAL_PRICES_CSV` (optional) | Path to an imported official price file |
| `server/.env` | `COMPETITIVE_DATA_DIR` (optional) | Folder holding the competitive-price CSVs. Default: `../data_csv`, else `./data_csv` |

Secrets never go to the frontend or to git.

### Scripts

| Where | Command | What it does |
|---|---|---|
| root | `npm run dev` / `build` / `lint` / `preview` | Vite dev server, typecheck + production build, oxlint, preview |
| root | `npm run verify:quick` / `verify` | verification harness (see Verification) |
| `server/` | `npm run dev` / `build` / `start` | API with reload, compile, run compiled |
| `server/` | `npm test` / `test:pure` | all backend tests (real database) / database-free tests |
| `server/` | `db:generate`, `db:migrate`, `db:counts`, `verify:api`, `verify:forecast`, `analyze:data`, `analyze:competitive` | Prisma and check scripts |

## Forecasting

Zero-filled daily unit series per product; models: historical mean (**baseline**), 7-day moving average, simple exponential smoothing. History is split chronologically into **train | validation (7 days) | test (7 days)** (needs ≥ 21 days). The model is selected on validation using train only; MAE and WAPE are then measured on the test days using train + validation only; the final forecast is refitted on everything. Data is never shuffled and test data never influences training or selection; tests prove this. Endpoint: `GET /api/analytics/forecast/validated?days=7` (the older `/forecast` is unchanged).

Honest limits: flat daily rate (no trend, weekday, season), no promotions/festivals/weather, high error when daily sales are sparse, and days with no recorded sales count as zero demand (the app warns when the history has large gaps). On the current data the selected model reduced test error versus the baseline, but daily WAPE is still high (see `npm run verify:forecast`).

## Data sources

- **Business data**: the shop's own records. All forecasts use only this.
- **External Indian market data**: official retail-price monitoring by the Department of Consumer Affairs, Government of India, on data.gov.in. **No data is imported yet.** The catalog page for the Milk dataset was checked on 2026-09-30 (publisher, 75 market centres, published/updated 21/09/2015) but showed no downloadable resource, and the API was unreachable from the development machine. The app supports dropping in an official CSV export (`server/data/external/README.md`), validates it, and shows its provenance. Until then the dashboard says no file is imported and shows no market numbers. No Kaggle, synthetic, scraped or invented data is used.

## Competitive price intelligence

Files in `data_csv/` (read by the server only; never modified; nothing stored in the database):

| File | What it is | Used as |
|---|---|---|
| `basket.csv` | 42 reference products | reference list |
| `prices_template.csv` | 210 rows labelled `COLLECTED` but with the selling price and availability blank in every row (only the MRP is filled) | empty template (0 observations) |
| `prices.csv` | 210 rows, 5 platforms, all labelled `SAMPLE` | sample data, always labelled |
| `zepto_dataset.csv` | 3,732 rows; 3,731 valid and 1 rejected (line 3608, zero MRP); 1,931 exact duplicates merged into 1,800 records; 39 conflicting records; 4 rows with weight 0; 1,281 products listed under several category labels; Zepto only, no date/location/brand | provided dataset (Zepto only) |

- **What you see (Market page):** one table, **Blinkit vs Zepto** (Product | Blinkit | Zepto), built from `prices.csv`. The shop's own products are not involved. Because every row in that file is labelled `SAMPLE`, the page shows a "Sample prices" badge and says prices are not live. The data-file validation, platform coverage, Zepto statistics and reference-basket matches are available from the API (`GET /api/analytics/competitive-prices`), not shown in the UI. A shop-vs-platform endpoint (`.../competitive-prices/shop?platform=`) exists but is not used by the UI: none of the shop's products (brand + size) appear in the provided data.
- **Honest coverage:** no platform has verified collected observations. The app says "Verified Blinkit observations are not available in the provided dataset." Nothing is live, real-time or current; no file records a date.
- **Price unit:** Zepto prices look like paise; they are divided by 100 only because a data check passed (3,731 of 3,731 MRPs are whole multiples of 100; median ₹110), and the API states this. If the check failed, prices would not be converted.
- **Matching:** only brand + exact product name + identical pack size counts. On the provided files 3 of 42 reference products match confidently; 13 similar ones and 26 others are not compared (a match also needs the name to start with the brand and any multi-pack count such as "3s" to be visible).
- **API:** `GET /api/analytics/competitive-prices`, `.../observations?platform=&provenance=&q=&limit=&offset=`, `POST .../explain`.
- **Replace or update the data:** overwrite the files in `data_csv/` keeping the column names (matched by name, case-insensitive): `basket.csv` needs `product_id, category, brand, product_name, pack_size_value, pack_size_unit, reference_mrp_inr`; `prices.csv` and `prices_template.csv` need `product_id, category, brand, product_name, pack_size_value, pack_size_unit, platform, mrp_inr, selling_price_inr, available, data_source`; `zepto_dataset.csv` needs `Category, name, mrp, discountPercent, availableQuantity, discountedSellingPrice, weightInGms, outOfStock, quantity`. A missing column rejects that file with a message. Changed files are re-read automatically; `COMPETITIVE_DATA_DIR` in `server/.env` points to another folder. A price row counts as `COLLECTED` only if it is labelled `COLLECTED` and contains values.
- **Check it:** `cd server && npm run analyze:competitive` prints the validation report for all four files (no database needed). `npm run analyze:data` prints it after the shop's own data report and therefore needs the database.

## Verification

```bash
npm run verify:quick     # typecheck, lint, pure tests, API smoke, forecast validation, build, DB-unchanged check
npm run verify           # the same plus the full backend suite (uses the real database, ~3 min)
cd server && npm test    # backend tests only
```

Last full run (`npm run verify`, 2026-10-01): 11 of 11 checks passed. Typecheck (frontend and backend), lint, pure tests, API smoke, forecast validation, the production build and all 312 backend tests pass, and database row counts were unchanged. Simultaneous sales never oversell; if a waiting sale cannot complete the API returns a 409 "please try again" instead of a server error.

## AI-augmented development workflow

`.claude/` holds project **skills** (`retail-data-analysis`, `demand-forecasting`, `inventory-intelligence`, `codebase-verification`), **commands** (`/verify-project`, `/run-forecast-validation`, `/analyze-retail-data`), **hooks** (a guard that blocks secret access and destructive database/git commands, and a post-edit typecheck/test hook; self-tested by `node .claude/hooks/hooks.test.mjs`) and read-only review **subagents** (the first session ran them as general-purpose agents given the role files, because project agents register only at session start; the competitive-price work later spawned `data-validator`, `code-verifier` and `documentation-reviewer` by name). No MCP server was used (the browser extension was not connected in this environment). See `CLAUDE.md`.

## Limitations

Single store; a few weeks of history; simple forecasts; competitor data is a provided Zepto dataset plus sample rows (no verified Blinkit or other platform observations, no dates or locations); only 3 of 42 reference products match confidently; the reference MRPs in basket.csv have no stated source; official Government price data not yet imported; the UI was checked by typecheck, build, headless-browser rendering and screenshots, not by scripted clicking; the Market page shows sample (not real, not live) Blinkit and Zepto prices; retail endpoints are not protected by sign-in; one older duplicate "Noodles" row that holds a recorded sale remains in the live database.

## Future work

Verified, dated Blinkit / Zepto / DMart data (only through legal, public sources), automated competitor monitoring, promotion comparison ("if I am Zepto, why am I falling behind competition?"), festival seasonality, weather, supplier lead times, multi-branch, CSV import of business data, deep learning, authentication, automatic purchase orders.
