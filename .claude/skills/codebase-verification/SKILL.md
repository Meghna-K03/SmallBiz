---
name: codebase-verification
description: Verify SmallBiz Lens end to end without harming the live database: typecheck, lint, tests, API smoke, forecast validation, production build, and a before/after row-count check. Use after any significant change and before reporting work as done.
---

# Codebase verification

Baseline first, then change, then verify. Record failures that existed **before** your change separately from new ones.

## Commands

| Need | Command |
|---|---|
| Everything, fast (skips the slow DB tests) | `npm run verify:quick` |
| Everything | `npm run verify` (backend DB tests take ~2 min) |
| Backend pure tests only | `cd server && npm run test:pure` |
| Row counts / sales range | `cd server && npm run db:counts` |
| Read-only API smoke | `cd server && npm run verify:api` |
| Forecast split + leakage on real data | `cd server && npm run verify:forecast` |
| Hooks self-test | `node .claude/hooks/hooks.test.mjs` |

## Rules

- Read the output. "Looks correct" is not verification.
- Fix a failing test by fixing the code, unless the test itself is wrong; then explain why. Never delete or weaken a test to get green.
- The database holds the owner's real data. Never run `prisma migrate reset`, `db push --force-reset`, TRUNCATE, mass DELETE or `db:seed`. The guard hook blocks these.
- Tests create only temporary `ZZ …` products and delete exactly those. After a run, `leftoverTestProducts` from `db:counts` must be 0 and counts must match the snapshot taken before.
- Do not commit or push unless the user explicitly asks.
