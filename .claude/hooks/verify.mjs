// PostToolUse verification hook. Runs after Edit / Write.
// Change -> automatic check, so a broken edit is reported immediately:
//   server/**/*.ts  -> backend typecheck (~1s); plus the pure test suite when the edit is in
//                      forecasting, priority, external data, AI explanation or a test file (~2s)
//   src/**/*.ts(x)  -> frontend typecheck (~3s)
// Deliberately NOT run here (too slow for every edit): the database-backed test suite and the
// production build. Those run in `npm run verify` (the /verify-project command).
// Exit code 2 reports the failure to Claude; exit 0 stays silent.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let file = ''
try {
  file = String(JSON.parse(readFileSync(0, 'utf8')).tool_input?.file_path ?? '')
} catch {
  process.exit(0)
}
const rel = path.relative(root, path.resolve(file)).replace(/\\/g, '/')
if (rel.startsWith('..') || !/\.(ts|tsx)$/.test(rel)) process.exit(0)

const steps = []
if (rel.startsWith('server/')) {
  steps.push(['backend typecheck', 'npx tsc --noEmit', path.join(root, 'server')])
  if (/^server\/(src\/services\/(forecasting|external|competitive|priority|aiExplanation|dataSource)|test\/)/.test(rel) || /Intelligence|forecast/i.test(rel)) {
    steps.push(['pure backend tests', 'npm run -s test:pure', path.join(root, 'server')])
  }
} else if (rel.startsWith('src/')) {
  steps.push(['frontend typecheck', 'npx tsc -p tsconfig.app.json --noEmit', root])
}

for (const [name, cmd, cwd] of steps) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 100_000 })
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-30).join('\n')
    console.error(`Verification hook: ${name} FAILED after editing ${rel}\n${out}`)
    process.exit(2)
  }
}
process.exit(0)
