# SmallBiz Lens — Specification

SmallBiz Lens is retail intelligence and demand planning for a small shop. Core question:

> What is happening in my business, what products need attention, and what demand should I expect next?

This document separates what is **implemented** from **future work**. It describes the code as it is, not a wish list.

---

# Part 1 — Implemented

## 1. Users and structure

Primary user: a small retail shop owner (demo business: "Sharma Grocery Store" by default). Pages: **Overview** (the former Dashboard), **Inventory, Sales, Expenses, Market**, behind a basic account sign-in. Purchases/restocking live inside Inventory; there is no Purchases page and no Analytics page.

**Accounts and login (implemented).** Create an account with email, mobile and password (scrypt hash, sessions are random tokens stored as SHA-256, 30-day expiry); sign in with email and password; sign out; change password (needs the current one). The login screen is a white card over a full-screen background image with a password show/hide toggle. After the server accepts a sign-in a short transition plays (fruit/vegetable tiles, a cart, the tiles circling the cart and entering it one by one), then the app opens. A failed sign-in shows an error and plays nothing. Routes `POST /api/auth/{register,login,logout,change-password}`, `GET /api/auth/me`, `PUT /api/auth/profile`. The retail data endpoints are not protected by the session (kept compatible); there is no email reset, rate limiting or verification.

**Shop profile (implemented).** Name, description, phone and location are editable from the sidebar profile panel and stored on the account (four nullable columns); unset fields show defaults (phone defaults to the registered mobile). The sidebar name updates immediately and after a refresh.

## 2. V1 business management (unchanged)

- **Products**: name, category, unit, selling price, purchase price, opening stock, minimum stock level (the "reorder level"); add / edit / delete; stock status Healthy / Low Stock / Out of Stock.
  - Units offered: grams (g), kilograms (kg), millilitres (ml), litres (L), pieces, packs, boxes, bags, bottles, trays, cans (older `liters` values still display and edit). The unit is a label; nothing converts between units.
  - Duplicates: a new product with the same name **and** unit as an existing one (case and extra spaces ignored) is rejected with 409 "… is already in your inventory."; different names (sizes) or units are allowed; editing is checked only if name or unit changes. There is no database unique constraint and existing duplicates are not removed.
  - Inventory table: Product, Category, Current Stock, Selling Price, Status, Sells per day (whole number), Movement, Actions (Insight, Edit, Delete). Reorder level, purchase price and coverage are not shown in the table.
- **Purchases / restocking**: product, quantity, purchase price, date, optional supplier; history.
- **Sales**: product, quantity, selling price, date; history; a sale that exceeds available stock is rejected.
- **Expenses**: category, amount, date, description; history.
- **Rules** (deterministic, no AI):
  - Current Stock = Opening Stock + Purchased − Sold (computed, never stored).
  - Low Stock = Current Stock ≤ Minimum Stock Level.
  - Revenue = total recorded sales; Estimated Profit = Revenue − Expenses (labelled an estimate).
- Data is stored in Supabase Postgres via Prisma and served by a REST API.

## 3. Overview (dashboard)

Four totals (sales with today's sales, expenses, estimated profit, inventory value = Σ current stock × purchase price), a 14-day sales trend chart, best sellers, "Needs attention" (restock priority), "What's likely to sell next?" (7 / 14 / 30 days, forecast and suggested quantity), and recent activity; forecast accuracy (selected method, test period, error vs the simple-average baseline, data-quality warning) is shown under "View forecast details" and in the product Insight modal. Charts display whole numbers (axis labels and tooltips); the underlying values are unchanged. External market data is not shown on the Overview.

## 4. Analytics (backend, read-only)

Sales trend, top and fast/slow/no-sales products, average daily sales (sales velocity), estimated days of stock remaining (stock coverage), low-stock products, inventory value. Endpoints: `GET /api/analytics/summary`, `/product-insights`.

## 5. Demand forecasting

Endpoint `GET /api/analytics/forecast/validated?days=N` (1–365, default 7). The older `GET /api/analytics/forecast` (historical average) is unchanged.

- Zero-filled daily series; models: historical mean (**baseline**), 7-day moving average, simple exponential smoothing.
- Chronological split train / validation (7 days) / test (7 days), minimum 21 days of history; never shuffled.
- Model selected on validation; **MAE and WAPE** reported on the test window for the selected model and the baseline; final forecast refitted on all history.
- Response includes: history period, train/validation/test periods, selected model, baseline, per-model validation scores, pooled and per-product MAE/WAPE, average daily demand, predicted demand, data status, held-out actual-vs-predicted days, `dataQuality`, and a limitation note.
- No temporal leakage (proved by tests). With < 21 days the baseline is used and no accuracy is claimed.
- Limitations: no trend, weekday, seasonality, promotions, festivals, weather or price effects; estimates, not guarantees; missing days count as zero demand.

## 6. Inventory intelligence

- `GET /api/analytics/restocking?days=N` (baseline forecast, as before) and `&forecast=validated` (validated forecast). Recommended quantity = max(0, ceil(forecast + minimum stock − current stock)).
- `GET /api/analytics/inventory-intelligence?days=N`: stock, forecast, recommended quantity, priority, reasons, advisory wording, reliability note, inventory value.
- Priority: **High** (out of stock, at/below minimum, or < 3 days of stock), **Medium** (less than the horizon of stock, or a suggested quantity), **Low**. Demand rules apply only when sales history is sufficient. Advisory only: "Consider restocking soon"; nothing is ordered.

## 7. Data sources

- **Business data** (the shop's records) drives every calculation.
- **External Indian market data**: adapter for official Department of Consumer Affairs retail-price data (data.gov.in). `GET /api/external/market-prices` returns status, provenance and per-commodity signals.
  - **Current state: no file imported, so no market figures.** The source pages were verified (2026-09-30) but no downloadable file or API access was obtained (see CLAUDE.md). The adapter ingests an official CSV export placed by the user (`server/data/external/README.md`).
  - Kept separate from business data; labelled "External Indian Market Data"; does not affect forecasts.
- `dataSource.ts` defines `BusinessDataSource` and `ExternalMarketSource` so other sources can be added without changing analytics or forecasting.

## 7a. Competitive price intelligence (external CSV data)

Market context from four CSV files in `data_csv/`. Completely separate from the shop's data: nothing is stored in the database and nothing feeds sales, stock, revenue, expenses, profit, forecasting, restocking or inventory intelligence.

- **Files and how each is treated**
  - `basket.csv`: 42 reference products (brand, name, pack size, reference MRP). Reference only.
  - `prices_template.csv`: 210 rows labelled `COLLECTED` but with the selling price and availability blank in every row (only the MRP is filled): **empty template rows, not observations**.
  - `prices.csv`: 210 rows (Blinkit, Zepto, Instamart, Flipkart Minutes, Amazon Now) all labelled `SAMPLE`: **sample data**, always labelled as such.
  - `zepto_dataset.csv`: 3,732 rows; 3,731 valid and 1 rejected (line 3608, zero MRP); 1,931 exact duplicates merged into 1,800 records; 39 conflicting records; 4 rows with weight 0; 1,281 products listed under several category labels; **Zepto only**, no date/location/brand column, collection method undocumented: a **provided dataset**.
- **Platforms:** no platform has verified collected observations. The app states: "Verified Blinkit observations are not available in the provided dataset." Blinkit appears only in sample rows; no Blinkit data is derived from Zepto.
- **Normalisation:** one canonical `PriceObservation` per record with provenance (`COLLECTED`, `DATASET`, `SAMPLE`, `TEMPLATE`, `UNVERIFIED`); unknown fields are `null`. Zepto prices are converted from paise to rupees only after a data-driven check (all MRPs whole multiples of 100, plausible median); otherwise they are not converted.
- **Validation:** per-file total / valid / rejected / template counts with reasons and line numbers; exact duplicates merged; conflicting records kept apart; suspicious values reported as warnings.
- **Matching:** basket product ↔ Zepto record only when brand, exact product name and an identical pack size all agree (3 of 42 confirmed on the provided files; 13 possible and 26 unmatched are listed with reasons and never compared; a multi-pack reference such as "3s" must be visible in the record, and word order and name-start-with-brand are required).
- **Calculations (backend only):** discount %, price difference (B − A, ₹ and %), availability, cheapest/spread over in-stock priced platforms, Zepto-vs-Blinkit pair when both exist. Comparisons from sample rows are labelled sample.
- **Configuration:** files live in `data_csv/` (override with `COMPETITIVE_DATA_DIR`); required column names are listed in README.md; changed files are re-read automatically.
- **API:** `GET /api/analytics/competitive-prices`, `GET /api/analytics/competitive-prices/observations`, `GET /api/analytics/competitive-prices/shop?platform=Zepto|Blinkit` (shop price vs one platform; Blinkit uses the SAMPLE rows and is marked `basis: "SAMPLE"`; the confirmed-match rules are in `shopComparison.ts` and need brand, product type, one g/kg size, and exactly one fitting record), `POST /api/analytics/competitive-prices/explain` (the server looks up the numbers; the client names the comparison). **The UI currently calls only the first.**
- **Market page (implemented):** the page "Market Comparison" has one card, "Blinkit vs Zepto", a table Product | Blinkit | Zepto built from `platformComparisons`: the collected set if present, otherwise the sample set, keeping products in stock with a price on both platforms (40 of 42 reference products on the provided files). The shop's own products are not involved. Because every platform row is labelled `SAMPLE`, the card shows a "Sample prices" badge and a note that prices are not live. Two products are left out because they have no in-stock price on one of the two platforms. An earlier shop-vs-platform view was removed from the UI: on the provided data no shop product (brand + size) exists in the Zepto dataset or the Blinkit sample rows, so it always showed zero matches.
- **AI:** the existing grounded Groq layer explains a calculated comparison; it must call sample data sample data, may not invent platforms, prices, dates, sources or statistics, and falls back to deterministic text.
- **Limitations:** nothing is live, real-time or current; no file records a date; the Zepto file's origin is undocumented; sample rows are illustrative; the Zepto file's category labels are inconsistent; the reference MRPs in `basket.csv` have no stated source.

## 8. AI explanation

`POST /api/analytics/explain` (Groq, server-side). Input: verified values (stock, minimum, demand, forecast, recommended quantity, status, plus optional priority, forecast method, reliability, forecast error). The AI may explain them; it must not invent sales, prices, inventory, forecasts, competitors, market data or sources, and says it lacks information outside the supplied values. Replies with unsupplied numbers are rejected; on any failure a deterministic explanation is returned. The UI labels "Calculated by system" and "AI explanation" / "Standard explanation".

## 9. Development workflow

Project skills, commands, hooks and read-only review subagents exist under `.claude/`; the verification harness is `npm run verify`. See CLAUDE.md. No MCP server was used (the Chrome extension was not connected).

## 10. UI requirements

Clean, modern, professional, simple, responsive; no heavy gradients, glassmorphism, neon, or "AI dashboard" styling; existing components reused.

## 11. Verification status

Latest full run (2026-10-01, `npm run verify`): 11 of 11 checks passed. Backend: 312 tests pass (177 in the database-free `npm run test:pure` set); frontend and backend typecheck, lint (oxlint, errors only; it reports a few warnings), API smoke, forecast validation and the production build pass, and database row counts were unchanged. The UI was not click-tested in a browser.

**Sales under simultaneous requests:** stock is never oversold; if a waiting sale still cannot complete, nothing is recorded and the API returns 409 "Another sale for this product was being recorded at the same time. Please try again." instead of 500 (the sale transaction waits up to 15 s / 20 s). The concurrency test passed 6 of 6 repeated runs after this change.

**Known issues:** the duplicate check has no database unique constraint; one older duplicate "Noodles" (packs) row that holds a recorded sale remains; retail endpoints are unauthenticated and CORS allows only `http://localhost:5173`.

---

# Part 2 — Future Work (not implemented)

- Live Blinkit / Zepto / DMart integration or scraping; verified, dated, located Blinkit observations (the provided files contain none); any legal, public competitive-price feed; automated competitor monitoring; promotion comparison; linking the shop's own products to competitor prices ("If I am Zepto, why am I falling behind?"). No competitor numbers are ever shown unless sourced and labelled.
- Importing and verifying a real official Indian price dataset (file drop-in is supported; none is imported yet), and linking commodities to products.
- Festival/Diwali seasonality, weekday effects, weather.
- Supplier management and lead-time optimisation.
- CSV import of business data.
- Multiple branches; complex authentication; payments; GST/accounting.
- Deep learning, reinforcement learning, more complex forecasting.
- Automatic purchase orders.
- A dedicated Purchases page if requirements grow.
