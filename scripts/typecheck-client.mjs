#!/usr/bin/env node
/**
 * Type-check every browser half.
 *
 * A package with a `src/client/` entry carries a second type program: JSX, the
 * DOM library, and the official client packages are not part of the Node-side
 * program (`tsconfig.json` excludes `packages/*\/src/client/**` on purpose, so
 * host code cannot quietly reach for `window`). Each such package therefore
 * ships its own `tsconfig.client.json`, and this script runs all of them — the
 * root `pnpm run typecheck` alone would leave the browser halves unchecked.
 *
 * Exit code: 0 when every browser program type-checks, 1 otherwise.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')

const programs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesDir, entry.name, 'tsconfig.client.json'))
  .filter((config) => existsSync(config))
  .toSorted()

if (programs.length === 0) {
  console.log('typecheck:client: no browser half in this workspace')
  process.exit(0)
}

let failed = 0
for (const program of programs) {
  const name = program.slice(root.length + 1)
  try {
    execFileSync('pnpm', ['exec', 'tsc', '-p', program], { cwd: root, stdio: 'pipe', encoding: 'utf8' })
    console.log(`typecheck:client: ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`typecheck:client: ✗ ${name}`)
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    if (output) console.error(output)
  }
}

if (failed > 0) {
  console.error(`typecheck:client: ${failed} of ${programs.length} browser program(s) failed`)
  process.exit(1)
}
console.log(`typecheck:client: OK — ${programs.length} browser program(s)`)
