import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The resident token budget gate is the only thing standing between a careless
 * description edit and a permanent per-request cost, so its arithmetic and its
 * failure paths are tested against fixture workspaces rather than trusted.
 *
 * `TOKEN_BUDGET_ROOT` points the script at a temporary workspace laid out like
 * this repository: a `packages/<name>/` per entry, each with a manifest and a
 * built `lib/index.js`.
 */
const repoRoot = join(import.meta.dirname, '..', '..')
const script = join(repoRoot, 'scripts', 'token-budget.mjs')

/** Build a fixture plugin whose model-visible projection is `padding` chars long. */
function fixturePlugin(dir: string, name: string, padding: number, budget: number | undefined): void {
  const packageDir = join(dir, 'packages', name)
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name,
    version: '0.0.0',
    ...(budget === undefined ? {} : { dsh: { tokenBudget: { resident: budget } } }),
  }, null, 2)}\n`)
  writeFileSync(join(packageDir, 'lib', 'index.js'), `export const name = ${JSON.stringify(name)}
export function apply(ctx) {
  ctx.tools.register({ name: 'x', description: ${JSON.stringify('d'.repeat(padding))}, parameters: {} })
}
`)
}

/** Run the gate against a fixture root and capture its outcome. */
function runGate(root: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [script], {
      encoding: 'utf8',
      env: { ...process.env, TOKEN_BUDGET_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

const scratch: string[] = []
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'token-budget-'))
  scratch.push(dir)
  return dir
}

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true })
})

describe('resident token budget gate', () => {
  it('passes when the measured projection is exactly the declared budget', () => {
    const dir = workspace()
    // Projection = `{"name":…,"description":…,"parameters":{}}`; the assertion is
    // the script's own 4-chars-per-token rule, so read the number it prints.
    fixturePlugin(dir, 'at-budget', 80, 45)
    const first = runGate(dir)
    const measured = Number(/at-budget\s+1\s+0\s+(\d+)/.exec(first.stdout)?.[1] ?? Number.NaN)
    expect(Number.isNaN(measured)).toBe(false)

    rmSync(join(dir, 'packages', 'at-budget'), { recursive: true, force: true })
    fixturePlugin(dir, 'at-budget', 80, measured)
    const second = runGate(dir)
    expect(second.code).toBe(0)
    expect(second.stdout).toContain('resident token budget ok')
  })

  it('fails when a package exceeds its declared budget', () => {
    const dir = workspace()
    fixturePlugin(dir, 'over-budget', 400, 10)
    const result = runGate(dir)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('over-budget')
    expect(result.stderr).toContain('> budget 10')
  })

  it('fails when a package declares no budget at all', () => {
    const dir = workspace()
    fixturePlugin(dir, 'no-budget', 40, undefined)
    const result = runGate(dir)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('declare `dsh.tokenBudget.resident`')
  })

  it('measures a hook-only package as zero without failing on host APIs it does not stub', () => {
    const dir = workspace()
    const packageDir = join(dir, 'packages', 'hook-only')
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
      name: 'hook-only',
      version: '0.0.0',
      dsh: { tokenBudget: { resident: 0 } },
    }, null, 2)}\n`)
    // Deliberately touches members the stub does not model, like a policy plugin
    // reaching for `ctx.on` and an arbitrary service.
    writeFileSync(join(packageDir, 'lib', 'index.js'), `export function apply(ctx) {
  ctx.on('tools/pre-execute', () => undefined)
  ctx.reflect.provide('thing', {})
}
`)
    const result = runGate(dir)
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/hook-only\s+0\s+0\s+0\s+0\s+0\s+0/)
  })
})
