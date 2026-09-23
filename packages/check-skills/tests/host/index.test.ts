/**
 * Plugin-wiring tests: what `apply` registers, what the tool returns, and the
 * derivation that ties the package name, entry id and tool name together.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

import { apply, inject, name, runCheckSkills } from '../../src/index.ts'
import {
  DEFAULT_CATALOG,
  catalogEvent,
  headerEvent,
  otherToolCallEvent,
  skillCallEvent,
  skillResultEvent,
} from '../fixtures/session-log.ts'

/**
 * Minimal host stub: records what `apply` registers. It implements only the one
 * member this plugin touches, so an accidental dependency on another host
 * service shows up as a thrown TypeError instead of passing silently.
 */
function createFakeContext() {
  const tools: ToolDefinition[] = []
  const ctx = {
    // The health service extends cordis' `Service`, which publishes itself through
    // `ctx.reflect.provide`; the real host always has it, so the stub mirrors that
    // contract instead of letting the plugin take a different path under test.
    reflect: {
      provide: (name: string, value: unknown) => {
        (ctx as unknown as Record<string, unknown>)[name] = value
      },
    },
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        tools.push(definition)
      }),
    },
  }
  return { ctx: ctx as unknown as Context, tools }
}

/** Execution identity the execute body never reads. */
const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

describe('check_skills plugin', () => {
  it('declares the host service it uses', () => {
    expect(name).toBe('tool-check-skills')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one tool named check_skills when applied', () => {
    const { ctx, tools } = createFakeContext()

    expect(() => apply(ctx)).not.toThrow()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('check_skills')
  })

  it('declares the three audit parameters', () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    const parameters = tools[0]?.parameters as
      | { properties?: Record<string, unknown>, required?: string[] }
      | undefined

    expect(Object.keys(parameters?.properties ?? {}).toSorted())
      .toEqual(['applicableSkills', 'evidenceDir', 'sessionPath'])
    // None is required: the audit has a defined answer for every omission —
    // the newest session, the newest expectation list, and no report.
    expect(parameters?.required).toBeUndefined()
  })

  it('returns the documented shape for a session whose skill was used', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-skills-index-'))
    try {
      const path = join(dir, 'session.v3.jsonl')
      const events = [
        headerEvent(),
        catalogEvent(),
        skillCallEvent('alpha-protocol', 'call-1', 3),
        skillResultEvent('alpha-protocol', 'call-1', 4),
        otherToolCallEvent('read_file', 'call-2', 5),
      ]
      writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`)

      const result = runCheckSkills({ sessionPath: path, applicableSkills: ['alpha-protocol'] })

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.verdict).toBe('ok')
      expect(result.task).toEqual({ applicableSkills: ['alpha-protocol'], source: 'argument' })
      expect(result.catalog).toEqual({
        count: DEFAULT_CATALOG.length,
        names: DEFAULT_CATALOG.map((entry) => entry.name),
        present: true,
        called: ['alpha-protocol'],
      })
      expect(result.calls).toHaveLength(1)
      expect(result.calls[0]).toMatchObject({ name: 'alpha-protocol', ok: true, usedAfterLoad: true })
      expect(result.missing).toEqual([])
      expect(result.sessionPath).toBe(path)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns unreported and an empty verdict list when no expectations are given', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)
    const dir = mkdtempSync(join(tmpdir(), 'check-skills-index-'))
    try {
      const path = join(dir, 'session.v3.jsonl')
      writeFileSync(path, `${JSON.stringify(headerEvent())}\n${JSON.stringify(catalogEvent())}\n`)

      const result = await tools[0]?.execute({ sessionPath: path }, exec) as { verdict: string, missing: string[] }

      expect(result.verdict).toBe('unreported')
      expect(result.missing).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns a typed error rather than a verdict for an unreadable session', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)
    const dir = mkdtempSync(join(tmpdir(), 'check-skills-index-'))
    try {
      const result = await tools[0]?.execute(
        { sessionPath: join(dir, 'absent.jsonl'), applicableSkills: ['alpha-protocol'] },
        exec,
      ) as { status: string, code?: string }

      expect(result.status).toBe('error')
      expect(result.code).toBe('session_not_found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns a typed error for an empty session artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-skills-index-'))
    try {
      const path = join(dir, 'session.v3.jsonl')
      writeFileSync(path, '')

      const result = runCheckSkills({ sessionPath: path, applicableSkills: ['alpha-protocol'] })

      expect(result.status).toBe('error')
      if (result.status !== 'error') return
      expect(result.code).toBe('session_empty')
      expect(result.sessionPath).toBe(path)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes the evidence report and reports its path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-skills-index-'))
    try {
      const path = join(dir, 'session.v3.jsonl')
      writeFileSync(path, `${JSON.stringify(headerEvent())}\n${JSON.stringify(catalogEvent())}\n`)
      const evidenceDir = join(dir, 'evidence')

      const result = runCheckSkills({
        sessionPath: path,
        applicableSkills: ['alpha-protocol'],
        evidenceDir,
      })

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      expect(result.evidencePath).toMatch(/skill-usage-.*\.md$/)
      expect(readFileSync(result.evidencePath ?? '', 'utf8')).toContain('# Skill usage audit')
      expect(result.evidenceError).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * The names a DSH plugin carries are derived from one another rather than chosen
 * one by one. This suite pins the derivation, so a rename cannot leave the
 * manifest, the patch row, the plugin name and the tool name disagreeing.
 *
 *   npm package  soia-dsh-tool-check-skills   vendor prefix + official dsh- marker
 *   entry id     tool-check-skills            package name minus that prefix
 *   plugin name  tool-check-skills            what the loader row declares
 *   tool name    check_skills                 id minus the `tool-` kind prefix
 *
 * The package registers no prompt section, so no `tool:` name is derived — the
 * absence is asserted rather than a section being invented to fill the slot.
 */
/**
 * Read the package manifest and the patch row from disk, as the CLI sees them.
 *
 * Defined at module scope on purpose: it captures nothing, so rebuilding it per
 * call would be pure overhead.
 * @returns The four facts the derivation tests compare.
 */
function readManifestFacts(): {
  packageName: string
  entryId: string
  entryName: string
  budget: number
} {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string, dsh?: { tokenBudget?: { resident?: number } } }
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  return {
    packageName: packageJson.name,
    entryId: /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1] ?? '',
    entryName: /^\s*name:\s*(\S+)\s*$/m.exec(patch)?.[1] ?? '',
    budget: packageJson.dsh?.tokenBudget?.resident ?? 0,
  }
}

describe('name derivation', () => {
  const PACKAGE_PREFIX = 'soia-dsh-'

  it('derives the entry id from the package name by dropping the vendor prefix', () => {
    const { packageName, entryId } = readManifestFacts()

    expect(packageName.startsWith(PACKAGE_PREFIX)).toBe(true)
    expect(entryId).toBe(packageName.slice(PACKAGE_PREFIX.length))
  })

  it('keeps the patch row name equal to the package name', () => {
    const { packageName, entryName } = readManifestFacts()

    expect(entryName).toBe(packageName)
  })

  it('drops the kind prefix for the tool name, as the official tools do', () => {
    const { entryId } = readManifestFacts()
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    expect(name).toBe(entryId)
    expect(tools[0]?.name).toBe(entryId.replace(/^tool-/, '').replaceAll('-', '_'))
  })

  it('stays within an honest resident token budget for its tool block', () => {
    const { budget } = readManifestFacts()
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    // Same projection `scripts/token-budget.mjs` measures: what the model
    // receives, not the whole registered definition. This package adds no
    // prompt section, so the tool block is the entire resident cost.
    const tool = tools[0]
    const projection = JSON.stringify({
      name: tool?.name,
      description: tool?.description,
      parameters: tool?.parameters,
    })
    const tokens = Math.ceil(projection.length / 4)

    expect(budget).toBeGreaterThan(0)
    expect(tokens).toBeLessThanOrEqual(budget)
  })
})
