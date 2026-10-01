// PreToolUse guard. Runs before Bash / Read / Edit / Write / Grep / Glob.
// Exit code 2 blocks the tool call and shows the message to Claude. Exit 0 allows it.
//
// Protects: secret files (.env, .env.local, server/.env), API keys / database URLs,
// destructive database and git operations. See CLAUDE.md "Hooks".
import { readFileSync } from 'node:fs'

let event = {}
try {
  event = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0) // no readable payload: do not block
}

const tool = event.tool_name ?? ''
const input = event.tool_input ?? {}

const block = (reason) => {
  console.error(`Blocked by project guard hook: ${reason}`)
  process.exit(2)
}

// A secret env file: .env, .env.local, .env.production, server/.env ... but not .env.example.
const isSecretPath = (p) => {
  const base = String(p).replace(/\\/g, '/').split('/').pop() ?? ''
  return /^\.env(\..+)?$/.test(base) && !/\.example$|\.sample$|\.template$/.test(base)
}

// ---- file tools
for (const key of ['file_path', 'path', 'notebook_path']) {
  if (typeof input[key] === 'string' && isSecretPath(input[key])) {
    block(`"${input[key]}" holds secrets (API keys / database URLs). Ask the user to edit it; use .env.example for documentation.`)
  }
}
if (typeof input.glob === 'string' && /\.env/.test(input.glob) && !/example/.test(input.glob)) {
  block('searching .env files is not allowed.')
}

// ---- shell commands
if (tool === 'Bash' || tool === 'PowerShell') {
  const cmd = String(input.command ?? '')

  // Reading or copying a secret env file (allow .env.example).
  if (/(^|[\s"'=/\\])\.env(\.(?!example|sample|template)[\w.-]+)?(?=$|[\s"';|&)])/.test(cmd)) {
    block('the command touches a .env file, which holds secrets.')
  }
  // Printing secrets.
  if (/(GROQ_API_KEY|DATABASE_URL|DIRECT_URL)/.test(cmd) && /(echo|printenv|Write-Host|Write-Output|\benv\b|\bset\b|Get-ChildItem\s+env)/i.test(cmd)) {
    block('the command would print an API key or database URL.')
  }

  // Destructive database operations. The live database holds the owner\'s real records.
  const destructive = [
    [/prisma\s+migrate\s+reset/i, 'prisma migrate reset wipes the database'],
    [/db\s+push[^\n]*--force-reset/i, 'prisma db push --force-reset wipes the database'],
    [/--accept-data-loss/i, '--accept-data-loss can drop data'],
    [/\bTRUNCATE\b/i, 'TRUNCATE empties tables'],
    [/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, 'DROP removes tables'],
    [/\bDELETE\s+FROM\s+["`\w.]+\s*(;|$|")/i, 'DELETE without a WHERE removes every row'],
    [/prisma\s+db\s+seed|db:seed/i, 'the seed script deletes all rows before inserting (existing data would be lost)'],
    [/deleteMany\(\s*\)/, 'deleteMany() with no filter removes every row'],
  ]
  for (const [re, why] of destructive) if (re.test(cmd)) block(`${why}. Existing business data must stay intact.`)

  // Destructive or outward-facing git.
  if (/git\s+push\b/i.test(cmd)) block('pushing to GitHub needs the user to ask for it explicitly.')
  if (/git\s+reset\s+--hard|git\s+clean\s+-\w*f|git\s+checkout\s+--\s|git\s+branch\s+-D/i.test(cmd)) {
    block('this git command can discard work.')
  }
}

process.exit(0)
