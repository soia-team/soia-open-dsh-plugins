#!/usr/bin/env node
/**
 * Resident token budget check.
 *
 * A plugin that registers a tool or a prompt section is paid for on every model
 * request: the tool's model-visible projection (name + description + parameter
 * schema) joins the tool table, and the section text joins the system prompt.
 * Those numbers must not drift silently, so each package declares its budget in
 * `package.json` (`dsh.tokenBudget`) and this script recomputes the cost from the
 * **built** artifact — the same bytes the host would load.
 *
 * Estimate: DSH's token meter uses a fixed density of about 4 characters per
 * token, so `ceil(chars / 4)`. It is an estimate by construction: the budget is a
 * ratchet against drift, not a billed number. Chinese text costs roughly three
 * times this estimate, which is why model-visible resident text is English.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHARS_PER_TOKEN = 4
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Characters of the tool projection the model actually receives. */
function toolChars(tool) {
  const projection = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
  return JSON.stringify(projection).length
}

/**
 * A permissive stand-in for the host context.
 *
 * Two package shapes load here, and the stub has to survive both: a tool package
 * touches `tools.register` / `systemPrompt.section`, while a hook or service
 * package may use any other member cordis exposes (`ctx.on`, `ctx.reflect
 * .provide`, `ctx.fiber.effect`, …). Unknown members therefore resolve to
 * further callable stubs, so an unfamiliar API cannot make this gate fail for
 * the wrong reason — but a package that registers a tool or a section still has
 * to go through the two captured entry points below.
 */
function makeStub() {
  const callable = function () {}
  return new Proxy(callable, {
    get(_target, property) {
      // Never pretend to be a thenable: `await` on a stub must not hang.
      if (property === 'then') return undefined
      if (property === Symbol.toPrimitive || property === 'toString') return () => '[host stub]'
      return makeStub()
    },
    apply: () => makeStub(),
    construct: () => makeStub(),
  })
}

/** Apply one built plugin against the stub host and measure what it would add. */
async function measure(entryPath) {
  const module = await import(pathToFileURL(entryPath).href)
  const tools = []
  const sections = []
  const ctx = new Proxy(function () {}, {
    get(_target, property) {
      if (property === 'tools') {
        return { register: (definition) => { tools.push(definition); return () => {} } }
      }
      if (property === 'systemPrompt') {
        return { section: (section) => { sections.push(section); return () => {} } }
      }
      if (property === 'then') return undefined
      if (property === Symbol.toPrimitive || property === 'toString') return () => '[host stub]'
      return makeStub()
    },
    apply: () => makeStub(),
  })
  if (typeof module.apply === 'function') module.apply(ctx)
  const toolCharsTotal = tools.reduce((sum, tool) => sum + toolChars(tool), 0)
  const sectionChars = sections.reduce((sum, section) => sum + String(section.text ?? '').length, 0)
  const chars = toolCharsTotal + sectionChars
  const toTokens = (value) => Math.ceil(value / CHARS_PER_TOKEN)
  return {
    tools: tools.length,
    sections: sections.length,
    chars,
    tokens: toTokens(chars),
    toolTokens: toTokens(toolCharsTotal),
    sectionTokens: toTokens(sectionChars),
  }
}

/** Every workspace package that ships a built entry. */
function packages() {
  const dir = join(root, 'packages')
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ dir: join(dir, entry.name), manifest: join(dir, entry.name, 'package.json') }))
    .filter((entry) => existsSync(entry.manifest))
}

const evaluated = await Promise.all(packages().map(async (pkg) => {
  const manifest = JSON.parse(readFileSync(pkg.manifest, 'utf8'))
  const entry = join(pkg.dir, 'lib/index.js')
  const budget = manifest.dsh?.tokenBudget
  const name = manifest.name ?? pkg.dir

  if (!existsSync(entry)) {
    return { failure: `${name}: ${entry} missing — run \`pnpm run build\` first` }
  }
  if (budget === undefined) {
    return { failure: `${name}: declare \`dsh.tokenBudget.resident\` in package.json` }
  }

  const measured = await measure(entry)
  const overBy = measured.tokens - budget.resident
  return {
    row: { name, ...measured, budget: budget.resident },
    failure: overBy > 0
      ? `${name}: resident ${measured.tokens} > budget ${budget.resident} (over by ${overBy})`
      : undefined,
  }
}))

const rows = evaluated.flatMap((item) => (item.row ? [item.row] : []))
const failures = evaluated.flatMap((item) => (item.failure ? [item.failure] : []))

const width = rows.reduce((max, row) => Math.max(max, row.name.length), 4)
console.log(`${'package'.padEnd(width)}  tools  sections  tool  section  resident  budget  headroom`)
for (const row of rows) {
  console.log(
    `${row.name.padEnd(width)}  ${String(row.tools).padStart(5)}  ${String(row.sections).padStart(8)}`
    + `  ${String(row.toolTokens).padStart(4)}  ${String(row.sectionTokens).padStart(7)}`
    + `  ${String(row.tokens).padStart(8)}  ${String(row.budget).padStart(6)}`
    + `  ${String(row.budget - row.tokens).padStart(8)}`,
  )
}

if (failures.length > 0) {
  console.error(`\nresident token budget failed (${CHARS_PER_TOKEN} chars ≈ 1 token):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`\nresident token budget ok (${CHARS_PER_TOKEN} chars ≈ 1 token)`)
