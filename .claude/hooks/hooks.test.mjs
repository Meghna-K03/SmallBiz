// Tests the guard and verification hooks by feeding them the same JSON Claude Code sends.
// Usage: node .claude/hooks/hooks.test.mjs
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const run = (script, payload) =>
  spawnSync('node', [path.join(dir, script)], { input: JSON.stringify(payload), encoding: 'utf8' })

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })
const file = (tool_name, file_path) => ({ tool_name, tool_input: { file_path } })

// [description, payload, expected exit code]
const guardCases = [
  ['read server/.env', file('Read', 'C:\\proj\\server\\.env'), 2],
  ['read .env.local', file('Read', '/proj/.env.local'), 2],
  ['edit .env', file('Edit', '.env'), 2],
  ['read .env.example (allowed)', file('Read', '/proj/server/.env.example'), 0],
  ['cat .env via shell', bash('cat server/.env'), 2],
  ['echo the Groq key', bash('echo $GROQ_API_KEY'), 2],
  ['print DATABASE_URL', bash('printenv DATABASE_URL'), 2],
  ['prisma migrate reset', bash('npx prisma migrate reset --force'), 2],
  ['db push force reset', bash('npx prisma db push --force-reset'), 2],
  ['TRUNCATE', bash('psql -c "TRUNCATE sale"'), 2],
  ['DROP TABLE', bash('psql -c "drop table sale"'), 2],
  ['mass DELETE', bash('psql -c "DELETE FROM sale;"'), 2],
  ['DELETE with WHERE (allowed)', bash('psql -c "DELETE FROM sale WHERE id = 1"'), 0],
  ['db seed (wipes tables)', bash('npm run db:seed'), 2],
  ['git push', bash('git push origin main'), 2],
  ['git reset --hard', bash('git reset --hard HEAD~1'), 2],
  ['git status (allowed)', bash('git status'), 0],
  ['run tests (allowed)', bash('npm test'), 0],
  ['edit a source file (allowed)', file('Edit', '/proj/src/App.tsx'), 0],
]

let failed = 0
const report = (ok, name, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail}`)
}

for (const [name, payload, expected] of guardCases) {
  const r = run('guard.mjs', payload)
  report(r.status === expected, `guard: ${name}`, r.status === expected ? '' : ` (exit ${r.status}, expected ${expected})`)
}

// Verification hook: ignores non-code files and files outside the repo, and stays silent on a healthy tree.
const skip = run('verify.mjs', file('Write', 'README.md'))
report(skip.status === 0, 'verify: ignores non-TypeScript files')
const outside = run('verify.mjs', file('Write', 'C:\\elsewhere\\x.ts'))
report(outside.status === 0, 'verify: ignores files outside the repository')
const healthy = run('verify.mjs', file('Edit', path.join(dir, '..', '..', 'server', 'src', 'services', 'priority.ts')))
report(healthy.status === 0, 'verify: typecheck + pure tests pass on a healthy tree', healthy.status === 0 ? '' : `\n${healthy.stderr}`)

console.log(failed === 0 ? '\nAll hook checks passed' : `\n${failed} hook check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
