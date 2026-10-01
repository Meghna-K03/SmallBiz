---
name: inventory-intelligence
description: Work on SmallBiz Lens inventory rules: current stock, inventory value, restocking quantity, restock priority (High/Medium/Low) and the grounded AI explanation. Use when changing priority rules, restocking maths, inventory value, or what is sent to Groq.
---

# Inventory intelligence

All numbers are calculated by the backend from the shop's records. AI only explains them.

## Formulas (keep deterministic and explainable)

- Current Stock = Opening Stock + purchased − sold (never stored).
- Inventory Value = Σ max(current stock, 0) × purchase price, in integer cents (`calcInventoryValue`).
- Recommended quantity = max(0, ceil(forecast demand + minimum stock − current stock)).
- Priority (`services/priority.ts`): High = out of stock, at/below minimum, or cover < 3 days; Medium = cover < horizon or a suggested quantity; Low otherwise. Demand-based rules apply only when history is `Sufficient`; otherwise say so in `reliabilityNote`.

## Wording

Advisory, never absolute: "Consider restocking soon." Never "You must restock". Nothing is ordered automatically.

## AI layer (`services/aiExplanation.ts`)

- Input is validated field by field. New optional fields (`restockPriority`, `forecastModel`, `forecastReliability`, `forecastErrorPercent`) are added to the input **only when supplied**.
- The reply is rejected if it contains a number that was not supplied; a deterministic fallback is used instead. `source` says `groq` or `fallback`.
- The prompt forbids inventing sales, prices, inventory, competitors, market data or sources, and requires "I do not have that information" for anything outside the supplied values.
- The Groq key stays server-side (`GROQ_API_KEY`). Never print it. Tests stub the provider; never call the live API in tests.

## Checks

`cd server && npm run test:pure` (priority, inventory value, AI grounding) and `npm run verify:api`.
