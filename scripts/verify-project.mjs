// Full verification harness. Runs every check, prints one PASS/FAIL line per step and a summary.
// Nothing here writes to the database; row counts are compared before and after.
//
//   node scripts/verify-project.mjs           everything (backend DB tests take ~2 minutes)
//   node scripts/verify-project.mjs --quick   skips the slow database-backed backend tests
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = path.join(root, 'server')
const quick = process.argv.includes('--quick')
const results = []

function run(name, cmd, cwd, opts = {}) {
  const started = Date.now()
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const ok = r.status === 0
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${seconds}s)`)
  if (!ok) console.log(out.split('\n').slice(-40).join('\n'))
  else if (opts.show) console.log(opts.show(out))
  return out
}

const summary = (out) => out.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join(' | ')

const countsBefore = run('database snapshot (before)', 'npm run -s db:counts', server, { show: (o) => '      ' + o.trim() })
run('frontend typecheck', 'npx tsc -p tsconfig.app.json --noEmit', root)
run('backend typecheck', 'npx tsc --noEmit', server)
run('lint (errors only)', 'npx oxlint', root)
run('backend pure tests (forecasting, priority, AI grounding, external + competitive data)', 'npm run -s test:pure', server, { show: (o) => '      ' + summary(o) })
if (!quick) run('backend full test suite (uses the real database, read-safe)', 'npm test', server, { show: (o) => '      ' + summary(o) })
run('API smoke test (read-only) + database connectivity', 'npm run -s verify:api', server, { show: (o) => o.split('\n').filter((l) => l.startsWith('Database')).join('\n') })
run('forecast validation on real data (temporal split + leakage check)', 'npm run -s verify:forecast', server)
run('frontend production build', 'npm run -s build', root)
const countsAfter = run('database snapshot (after)', 'npm run -s db:counts', server)

const unchanged = countsBefore.trim() === countsAfter.trim()
results.push({ name: 'database unchanged by verification', ok: unchanged })
console.log(`${unchanged ? 'PASS' : 'FAIL'}  database unchanged by verification`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed${quick ? ' (quick mode: DB test suite skipped)' : ''}`)
process.exit(failed.length === 0 ? 0 : 1)
