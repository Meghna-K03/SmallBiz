# SmallBiz Lens — Development Instructions

## Purpose

SmallBiz Lens is **AI-powered retail intelligence and demand planning** for a small shop. It answers:

> What is happening in my business, what products need attention, and what demand should I expect next?

It uses the shop's own sales, purchases, stock and expenses to show product performance, flag inventory risk, forecast near-term demand and explain the results in plain language. It began as a small-business inventory/sales/expense app (V1); that V1 still works and is the base.

`SPEC.md` is the source of truth for requirements. Read it and this file before significant changes. Do not invent requirements or add pages/features that are not asked for.

---

# Architecture

```
Business data (Postgres via Prisma)         EXTERNAL data (separate; never merged; context only)
        │  BusinessDataSource                        ├─ Indian market prices (optional file import)
        ▼                                            │    GET /api/external/market-prices
  Data processing (zero-filled daily series)         └─ Competitive prices: data_csv/*.csv → validate →
        ▼                                                 normalise → match → calculate
                                                          GET /api/analytics/competitive-prices
  Analytics (stock, revenue, profit, inventory value, trend, top/slow movers, coverage)
        ▼
  Forecasting (temporal split → model selection → MAE/WAPE vs baseline → 7/14/30-day forecast)
        ▼
  Inventory intelligence (restock quantity + High/Medium/Low priority)
        ▼
  AI explanation (Groq, grounded; deterministic fallback)
        ▼
  Dashboard / Inventory UI
```

Stack (do not replace): React 19 + Vite + TypeScript + Tailwind 4 + Recharts (frontend, `src/`); Express 5 + TypeScript + Prisma 7 + Supabase Postgres + Groq SDK (backend, `server/`). Current stock is always computed (`opening + purchases − sales`), never stored.

Pages: Overview (route `/`, file `pages/Dashboard.tsx`), Inventory (products + purchase/restocking), Sales, Expenses, Market (`/market`), plus a `/login` screen. There is no Purchases page and no separate Analytics page. Overview = business health only (four totals, sales trend, best sellers, "Needs attention", "What's likely to sell next?", recent activity); forecast accuracy detail sits behind "View forecast details" and in the product modal.

**Market page (current behaviour):** one card, "Blinkit vs Zepto", a table of Product | Blinkit | Zepto. The shop's own products are NOT involved. Rows come from `GET /api/analytics/competitive-prices` (`platformComparisons`): the `COLLECTED` set if one exists, otherwise the `SAMPLE` set, keeping products in stock with a price on both platforms (40 of 42 on the provided files). Every row in `prices.csv` is labelled `SAMPLE`, so the card shows a "Sample prices" badge and the footer says prices are not live. There are no verified Blinkit or Zepto observations in the project. Earlier iterations compared the shop's products with Blinkit/Zepto; that returned zero matches because the provided data has no product with the shop's brand and size (for example no Tata Tea 250g), so the UI no longer does it. The backend route `GET /api/analytics/competitive-prices/shop?platform=Zepto|Blinkit` still exists (tested) but no UI calls it.

**Accounts (basic, real):** `Account` and `Session` tables (additive migration `20260930120000_add_accounts`; no retail table touched), routes `POST /api/auth/{register,login,logout,change-password}`, `GET /api/auth/me` and `PUT /api/auth/profile` (`server/src/routes/auth.ts`, hashing in `lib/password.ts` with Node's built-in scrypt, sessions are random tokens stored as SHA-256 with a 30-day expiry). Create account needs email, mobile, password, confirm; sign-in needs only email and password and accepts only registered accounts; change password needs the current password. The shop profile is **editable** (`PUT /api/auth/profile`, `GET /api/auth/me`): name, description, phone and location are stored in four nullable columns on `Account` (`shopName`, `shopDescription`, `shopPhone`, `shopLocation`; additive migration `20261001090000_add_shop_profile_fields`). Where a column is null, the defaults in `server/src/config/shopProfile.ts` apply (name, placeholder description, phone = the registered mobile, location empty). The profile lives in `AuthContext` so the sidebar name and the profile panel always agree; the UI is the sidebar name button (`components/profile/ShopProfileButton.tsx`, "Edit profile", "Change password", "Sign out"). The phone you edit is a profile field; the login mobile is unchanged. **Limitations:** the existing retail endpoints are still unauthenticated (kept compatible), there is no email reset, rate limiting or email verification. Tests: `test/auth.test.ts` (database, temporary `zz-auth-…` accounts only, includes profile editing) and `test/password.test.ts` (pure). **Visual system:** navy/ivory/terracotta, applied by redefining Tailwind's `slate-*`/`indigo-*` ramps in `src/index.css`; Fraunces (headings) and Inter (text). Restock priority keeps its High/Medium/Low logic; the UI shows it as "Restock soon" / "Plan a restock" / "Stock is healthy" (`PRIORITY_LABEL` in `InsightBits.tsx`). Presentation only: no calculation, API or schema changed by the redesign.

## Key files

| Area | Path |
|---|---|
| Business rules and analytics | `server/src/services/analytics.ts`, `insights.ts`, `inventory.ts` |
| Baseline forecast (kept, compatible) | `server/src/services/forecast.ts` |
| Validated forecast | `server/src/services/forecasting/{series,models,backtest,index}.ts` |
| Restock quantity | `server/src/services/restocking.ts` (`forecastSource: baseline | validated`) |
| Priority | `server/src/services/priority.ts` |
| Combined response | `server/src/services/inventoryIntelligence.ts` |
| Data-source adapters | `server/src/services/dataSource.ts`, `external/` |
| Competitive price intelligence | `server/src/services/competitive/{table,basket,platformPrices,zepto,matching,calculations,explain,index}.ts`; UI `src/components/competitive/CompetitivePriceSection.tsx` |
| AI explanation | `server/src/services/aiExplanation.ts` |
| Routes | `server/src/routes/analytics.ts`, `external.ts` |
| Frontend intelligence UI | `src/components/insights/`, `src/components/charts/ForecastVsActualChart.tsx` |

---

# Data sources and provenance

Three kinds of data, always kept apart and labelled in the UI ("Business data" vs "External Indian Market Data"):

1. **Business data**: Sharma General Store's own records in the database. All forecasts and priorities use only this.
2. **External Indian market data**: official retail prices from the **Department of Consumer Affairs (Price Monitoring Cell), Government of India**, published on the OGD platform (`data.gov.in`, "Daily/weekly Retail prices of …", group "Essential Commodities"). Licence per the portal: Government Open Data License – India (check the dataset's own terms).

**Status: partly verified, NOT imported.** On 2026-09-30 the catalog page for the Milk dataset was reachable and showed the publisher and licensing text (75 market centres, published/updated 21/09/2015) but no downloadable resource; other commodity datasets were not opened; `api.data.gov.in` was unreachable from the development machine, so which exports or API access exist is unverified; the `fcainfoweb.nic.in` price report page showed a CAPTCHA field (not automated). No records were obtained, so **no market figures exist in the app**. The adapter (`external/indiaRetailPrices.ts`) ingests an official CSV export placed at `server/data/external/india-retail-prices.csv` (see `server/data/external/README.md`), validates columns by name, drops and counts bad rows, and records provenance (publisher, URL, licence, retrieval date, period, fields, transformations, limitations). Until a file is imported the UI says so.

3. **Competitive price data** (`data_csv/`, read by `services/competitive/`; added after the two above): four CSV files supplied by the project owner. See the next section.

Rules: never Kaggle; never synthetic data presented as real; never fabricated or scraped Blinkit/Zepto/DMart numbers; never mix external data into the shop's sales; external data does not change any forecast.

---

# Competitive price intelligence (external CSV context)

Purpose: external market context (prices, discounts, availability) without touching the shop's own numbers. Raw files in `data_csv/` are never modified; nothing is stored in the database; nothing here is imported by analytics, forecasting, restocking, priority or inventory intelligence (a test enforces this). Server-side only: the browser receives normalised JSON, never the CSV files.

| File | What it actually is | Treated as |
|---|---|---|
| `basket.csv` | 42 reference products (id, category, brand, name, pack size, reference MRP). No platform, no observed prices. | reference list only |
| `prices_template.csv` | 210 rows (42 products × 5 platforms) labelled `COLLECTED`, but the selling price and availability cells are blank in every row (only the MRP is filled) | **empty template rows, counted, not observations** (the label is not trusted) |
| `prices.csv` | 210 rows (42 products × 5 platforms: Blinkit, Zepto, Instamart, Flipkart Minutes, Amazon Now), every row labelled `SAMPLE`; 11 unavailable rows have no price | **SAMPLE data**: shown, always labelled sample, never as collected |
| `zepto_dataset.csv` | 3,732 rows; 3,731 valid and 1 rejected (line 3608, zero MRP); 1,931 exact duplicates merged into 1,800 records; 39 conflicting records; 4 rows with weight 0; 1,281 products listed under several category labels; Zepto only. Columns: Category, name, mrp, discountPercent, availableQuantity, discountedSellingPrice, weightInGms, outOfStock, quantity. No date, location or brand column; collection method undocumented | **provided dataset** (Zepto only) |

- **Platforms:** Zepto (dataset + sample rows); Blinkit, Instamart, Flipkart Minutes, Amazon Now appear **only** in the SAMPLE rows. No platform has verified collected observations, so the UI shows: "Verified Blinkit observations are not available in the provided dataset." No Blinkit row is derived from Zepto data.
- **Normalisation** (`PriceObservation`): only source-supported fields are filled; unknowns are `null` (brand, date, location are `null` for Zepto). Provenance per row: `COLLECTED` (labelled collected and carrying values), `DATASET`, `SAMPLE`, `TEMPLATE`, `UNVERIFIED`.
- **Zepto price unit:** the file has no data dictionary, so `detectPriceUnit` decides from the data: prices are converted from paise (÷ 100) only if ≥ 99% of MRPs are whole multiples of 100 and the converted median is a plausible grocery price (here 3,731 of 3,731 MRPs, median ₹110). If that check fails, prices are **not** converted and no rupee values are shown. This is an inference from the data, documented in the API response.
- **Validation** (per file: total / valid / rejected / template rows, rejection reasons with line numbers, warnings): missing name, platform or category; invalid, zero or negative price or MRP; selling price above MRP; invalid discount or availability; duplicates (product + platform); unknown labels. `weightInGms = 0` means unknown pack size. Exact duplicate Zepto rows (same product, pack, prices, stock; category ignored) are merged; records with the same product and pack but different prices are kept and marked conflicting.
- **Zepto category labels are unreliable** (the same product appears under several categories), so no category breakdown is shown.
- **Matching** (basket ↔ Zepto dataset, `matching.ts`): *confirmed* only when the record name starts with the brand, the remaining product words (sizes removed) equal the reference words exactly and in order, the pack size is identical (reference unit `g` vs `weightInGms`, and any size written in the name agrees), any multi-pack count in the reference (e.g. `3s`) also appears in the record, and exactly one non-conflicting record fits. Extra or reordered words (possible variants), different pack sizes, ml/unit packs (the dataset has only a weight field), unverifiable multi-packs and brand-less produce are not compared. Result on the provided files: 3 confirmed (India Gate Basmati Rice, Tata Salt, Madhur Sugar), 13 possible (listed with reasons, not compared), 26 unmatched. An independent audit found the first, looser matcher confirmed a 3-pack reference against a single-pack record; the rules above are the fix, with tests.
- **Calculations** (`calculations.ts`, backend only): discount % = (MRP − selling) / MRP; price difference = B − A (₹ and % of A); availability; per-product platform comparison over in-stock, priced platforms only; Zepto-vs-Blinkit pair only when both exist, are in stock and priced. Comparisons built from SAMPLE rows are labelled sample in the API and UI.
- **Shop vs market** (`shopComparison.ts`, pure; `GET /api/analytics/competitive-prices/shop`, optional `?platform=Zepto|Blinkit`; Blinkit uses the SAMPLE rows and the response says `basis: "SAMPLE"`; **not used by the UI at present**): the route reads only `Product.name` and `Product.sellingPrice` (read-only) and compares them with the provided **Zepto dataset** records. Confirmed only when the shop name states a brand in parentheses (e.g. "Tea (Tata Tea 250g)"), exactly one g/kg pack size, identical product words, the same weight, and exactly one non-conflicting record; ml/L packs, extra words and brand-less names are not compared. difference = shop − platform, percent of the shop price; within 1% is "similar". Matching is two-stage: the strict matcher above, then a controlled stage 2 (brand and product type from the shop name, small safe brand-alias table, kg/g normalisation, pack count check, packaging-only extra words tolerated) that confirms only when exactly one record fits; named variants, several fits, ml/L packs and brand-less shop names stay `possible`/`unmatched`. Automated `ZZ …` test rows are excluded from the coverage count. Result on the current 12 real shop products: 0 confirmed, 3 possible, 9 unmatched; the cause is missing data (no Parle-G record, Tata Tea only as Gold 100 g, two Amul 1 L and two Britannia 400 g products, brand-less shop names), not formatting, so the Dashboard card says no matching market prices were found. The card ("Market Price Check") is compact: up to 6 rows, "View all comparisons", a coverage line, and the sample Zepto/Blinkit rows collapsed and labelled as illustration. Nothing is stored and no shop figure changes.
- **API:** `GET /api/analytics/competitive-prices` (provenance, files + validation, platform coverage, Zepto summary, matches, comparisons, limitations), `GET /api/analytics/competitive-prices/observations` (paged, filterable), `POST /api/analytics/competitive-prices/explain` (the client only names the comparison; the server looks up the numbers).
- **Replace or update data:** overwrite the files in `data_csv/` (same column names; matched by name) and reload; results refresh when a file changes. `COMPETITIVE_DATA_DIR` points elsewhere (default order: that variable, then `../data_csv`, then `./data_csv` relative to `server/`). Required columns are listed in README.md. Rows only become `COLLECTED` if labelled `COLLECTED` **and** carrying values.
- **Limitations:** nothing is live, real-time or current (no file records a date); the Zepto dataset's origin is undocumented; sample rows are illustrative; only 3 of 42 reference products could be confidently matched; the reference MRPs in `basket.csv` have no stated source or date.

# Products, units and the inventory table (current behaviour)

- **Units** (`Unit` in `src/types/index.ts`, `ProductForm.tsx`): grams (g), kilograms (kg), millilitres (ml), litres (L), pieces, packs, boxes, bags, bottles, trays, cans. The unit is a stored label only: stock and prices are integers/decimals independent of it, no calculation converts between units. Older products may still hold `liters`; the form keeps that value selectable when editing such a product but does not offer it for new ones.
- **Duplicates** (`server/src/routes/products.ts`): creating a product whose **name and unit** match an existing one (case, edge and repeated spaces ignored; comparison only, stored text is unchanged) returns 409 "<name> (<unit>) is already in your inventory." Editing is checked only when the name or unit changes, so products that were already duplicated stay editable. Different sizes are different names ("Tata Tea 250g" vs "500g"); the same name in a different unit is allowed. No database unique constraint exists, so two truly simultaneous identical creates could both succeed; existing duplicate rows are never removed automatically.
- **Inventory table columns:** Product, Category, Current Stock, Selling Price, Status, Sells per day, Movement, Actions (Insight / Edit / Delete). Reorder level, purchase price and coverage are not shown in the table (they remain in the product form and the Insight modal). "Sells per day" is `Math.round(salesVelocity)` for display (`formatVelocity`); the stored/calculated value keeps two decimals.
- **Charts** round displayed values to whole numbers (axis labels and tooltips) without changing data: `ForecastVsActualChart.tsx`, `SalesTrendChart.tsx`.

# Login screen (current behaviour)

`pages/Login.tsx`: white centred card on a full-screen background image (`public/login-bg.png`, `bg-cover`); Sign in / Create account tabs; password field with an eye toggle (hidden by default). The server call happens first and unchanged; the success transition (fruit/vegetable tiles around a cart, "Logging you in...", "Sit tight, we're getting your store ready.", then the tiles circle the cart and enter it one by one, then the app opens, ~5.4 s in total) starts only after the server accepts the sign-in, and the session is created when it ends. A failed sign-in shows the error and plays nothing. The logo is `public/logo.png` (`LogoMark` in `components/ui/Icons.tsx`).

# Forecasting and leakage prevention

- Zero-filled daily unit series per product over the history (earliest to latest sale date).
- Models (lightweight, explainable): **historical mean (baseline)**, **7-day moving average**, **simple exponential smoothing** (alpha picked from a fixed list using only the history it is given).
- Chronological split `|train|validation(7d)|test(7d)|`, needs ≥ 21 days (else baseline only, no accuracy claimed). Never shuffled.
  1. Selection: models fitted on **train**, scored on **validation** (pooled across products).
  2. Accuracy: selected model and baseline refitted on **train + validation**, scored on **test**: MAE and WAPE.
  3. Final forecast: selected model refitted on all history.
- Leakage tests (`server/test/forecasting.test.ts`, "no temporal leakage"): rewriting test values never changes model selection or test predictions; every model call receives only a prefix ending before the predicted period; validation values never change a train-only fit.
- `dataQuality.warning` is shown when many days have no recorded sales, because missing days count as zero demand.
- Live check on real data: `cd server && npm run verify:forecast`.

Limitations: flat forecasts (no trend/weekday/season), no promotions, festivals, weather or price effects; daily WAPE is high when daily sales are sparse; forecasts are estimates, never guarantees.

# Inventory intelligence

Priority (`priority.ts`): **High** = out of stock, at/below minimum, or stock covers < 3 days; **Medium** = covers less than the horizon or a restock quantity is suggested; **Low** otherwise. Demand-based rules apply only with `Sufficient` history. Inventory value = Σ current stock × purchase price (integer cents). Wording is advisory ("Consider restocking soon"); nothing is ordered automatically.

# AI guardrails

- Business calculations are deterministic and are never delegated to AI.
- The backend sends Groq only verified values; the model may explain them, not invent sales, prices, inventory, forecasts, competitors, market statistics or sources. Anything outside the supplied values → "I do not have that information".
- Replies containing a number that was not supplied are rejected. On any Groq failure/timeout/missing key, a deterministic explanation is returned (`source: "fallback"`).
- Competitive comparisons reuse the same provider, number check and fallback (`explainComparison`): the prompt forbids other platforms, competitors, dates, sources, market statistics or "live/current" claims, requires calling sample data sample data, and any reply with a number not in the calculated comparison is rejected.
- The UI separates "Calculated by system" from "AI explanation". The key is server-side only (`GROQ_API_KEY`); never print or log it.

---

# AI-augmented development workflow (`.claude/`)

These are **development** tools, not product features.

| Kind | What exists | Notes |
|---|---|---|
| **Skills** | `retail-data-analysis`, `demand-forecasting`, `inventory-intelligence`, `codebase-verification` | Short, task-specific; they point to scripts rather than repeating this file. |
| **Commands** | `/verify-project`, `/run-forecast-validation`, `/analyze-retail-data` | Each runs real scripts (`scripts/verify-project.mjs`, `server/scripts/validate-forecast.ts`, `analyze-data.ts`) and reports actual output. |
| **Hooks** (`.claude/settings.json`) | see table below | Tested by `node .claude/hooks/hooks.test.mjs`. |
| **Subagents** (`.claude/agents/`) | `data-validator`, `forecast-validator`, `code-verifier`, `documentation-reviewer` | Read-only reviewers. Project agents register only at session start: in the session that created them the reviews ran as general-purpose agents given these role files; in the following session (competitive price intelligence) `data-validator`, `code-verifier` and `documentation-reviewer` were spawned by name and their findings fixed. |
| **MCP** | none configured for the project | The Chrome MCP tools were available in the environment but the browser extension was **not connected**, so MCP was not used. Do not claim MCP use. |

| Hook | Trigger | Action | Purpose |
|---|---|---|---|
| `guard.mjs` | PreToolUse: Bash, PowerShell, Read, Edit, Write, Grep, Glob | Blocks (exit 2) access to `.env`, `.env.local`, `server/.env` and printing of `GROQ_API_KEY`/`DATABASE_URL`/`DIRECT_URL`; blocks `prisma migrate reset`, `db push --force-reset`, `--accept-data-loss`, TRUNCATE, DROP, DELETE without WHERE, unfiltered `deleteMany()`, `db:seed`, `git push`, `git reset --hard`, `git clean -f`, `git checkout -- <file>`, `git branch -D` | Protect secrets and the live database |
| `verify.mjs` | PostToolUse: Edit, Write | For edited `.ts/.tsx`: backend or frontend typecheck; plus pure backend tests for forecasting/priority/external/AI/test files | Immediate feedback on a broken edit (~1–5 s) |

Not in hooks on purpose (too slow per edit): the database-backed test suite (~2.5 min) and the production build; they run in `npm run verify`.

# Verification workflow

1. Baseline before changes (typecheck, tests, build); record pre-existing failures separately.
2. After each group of changes run targeted tests, read the output, fix, re-run.
3. Finish with `npm run verify` (or `npm run verify:quick`). It compares database row counts before and after. See the verification status in README.md for the latest full-run result. Lint: `npm run lint` (oxlint) passes; frontend and backend typecheck and the production build pass.

Commands: `npm run verify`, `npm run verify:quick`; in `server/`: `npm test` (all, real DB), `npm run test:pure`, `npm run verify:api`, `npm run verify:forecast`, `npm run analyze:data` (needs the database), `npm run analyze:competitive` (CSV files only), `npm run db:counts`.

# Safety rules

- The database holds real, manually entered records. Never run `prisma migrate reset`, `db push --force-reset`, TRUNCATE, mass DELETE, or `db:seed` (it deletes all rows first). Tests create only temporary `ZZ …` rows and delete exactly those.
- Schema changes must be additive (the accounts tables and the four profile columns were). Verify existing data afterwards.
- Never commit or push unless the user explicitly asks. Never read or print secrets.
- Do not delete or weaken tests to get green. Keep existing routes compatible (add fields, do not rename).
- No unnecessary dependencies, pages, frameworks, deep learning, scraping or advanced authentication (basic accounts exist, see above).

# UI principles

Clean, modern, professional, simple, responsive, easy for a shop owner. Avoid heavy gradients, glassmorphism, neon colours, "AI research dashboard" styling, unnecessary animation. Reuse existing components. Always show what kind of data a figure comes from and how reliable it is.

# Known issues (final audit, 2026-10-01)

- **Simultaneous sales (fixed 2026-10-01).** Concurrent sales of one product queue on a row lock in `createSale` (`services/inventory.ts`); on the remote database the default Prisma transaction limits expired for the last waiting request (`P2028`, HTTP 500). The sale transaction now uses `maxWait` 15 s / `timeout` 20 s, and if a sale still expires or aborts (`P2028`/`P2034`) nothing is recorded and the API returns 409 "Another sale for this product was being recorded at the same time. Please try again." instead of 500. The stock check is unchanged and still runs under the lock, so stock is never oversold. The concurrency test passed 6 of 6 isolated runs after the change (it failed 2 of 3 before).
- The Insight modal (`ProductInsightModal.tsx`) shows sales velocity, expected demand and target stock as whole numbers and no longer shows the reorder level (the restock calculation still uses it). Coverage and forecast error percentages are unchanged.
- The leftover automated `ZZ …` test products and one duplicate "Noodles" (packs) row with no history were deleted on 2026-10-01. A second duplicate "Noodles" (packs) row that holds a recorded sale was kept, because deleting it would mean deleting a sale.
- Retail endpoints are unauthenticated; CORS allows only `http://localhost:5173`; no rate limiting, email reset or verification.
- `GET /api/external/market-prices`, `POST /api/analytics/competitive-prices/explain`, `GET .../competitive-prices/shop` and `/observations` are not called by the current UI.
- Market data is sample/provided only, nothing is live or dated.

# Future work (not implemented; do not start without approval)

Live Blinkit/Zepto/DMart integrations and any legal/public competitive-price feeds; competitor monitoring, price-gap and promotion comparison ("if I am Zepto, why am I falling behind?"); festival/seasonality and weather; supplier lead-time optimisation; multi-store; CSV import of business data; deep learning / reinforcement learning; advanced authentication; automatic purchase orders; hooks that run the full DB suite in CI.
