---
description: Inspect the shop's business data and the external Indian market data (provenance, date range, gaps, coverage, limitations)
allowed-tools: Bash(npm run analyze:data:*), Bash(npm run -s analyze:data), Bash(npm run -s db:counts)
---

Analyse the data. Use the `retail-data-analysis` skill.

1. Run `cd server && npm run analyze:data` (read-only).
2. Summarise **business data** and **external Indian market data** in two separate sections:
   - Business: date range, days with and without sales, longest gap, products with too little history, duplicate names, price problems.
   - External: status, official source and URL, publisher, license, retrieval date, data period, columns used, rows kept/dropped, limitations. If no official file is imported, say exactly that; do not describe or invent market figures.
3. Say what the data can support (forecasting, priority) and what it cannot.

Do not modify the database or any data file. Do not scrape any website.
