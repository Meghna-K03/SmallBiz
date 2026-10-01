---
description: Run the full SmallBiz Lens verification harness (typecheck, lint, tests, API smoke, forecast validation, build, database-unchanged check)
argument-hint: "[--quick]"
allowed-tools: Bash(npm run verify:*), Bash(npm run verify), Bash(node scripts/verify-project.mjs:*), Bash(node .claude/hooks/hooks.test.mjs), Bash(npm run db:counts:*)
---

Run the verification harness and report the real results. Use the `codebase-verification` skill.

1. Run `node scripts/verify-project.mjs $ARGUMENTS` (add `--quick` to skip the ~2 minute database-backed backend tests). It runs, in order: database snapshot, frontend typecheck, backend typecheck, lint, backend pure tests, backend full tests (unless `--quick`), read-only API smoke test with database connectivity, forecast validation on real data, frontend production build, database snapshot again, and a before/after comparison.
2. Run `node .claude/hooks/hooks.test.mjs` to confirm the guard and verification hooks still behave.
3. Report each step as PASS/FAIL with the actual counts (tests passed, rows before/after). Quote failing output verbatim.
4. If something fails, say whether it is new or was already failing, and fix it before re-running. Do not weaken or delete a test.

Never run destructive database commands. Do not commit or push.
