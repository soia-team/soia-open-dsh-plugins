import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply, inject, name } from '../../src/index.ts'

/** One prompt section as the plugin would hand it to the host registry. */
interface SectionStub {
  name: string
  order: number
  text: string
}

/**
 * Minimal host stub. It implements the two services a tool plugin could touch,
 * so an accidental dependency on anything else shows up as a thrown TypeError
 * rather than passing silently — and a section registration is recorded even
 * though this package must never make one.
 */
function createFakeContext() {
  const tools: ToolDefinition[] = []
  const sections: SectionStub[] = []

  const ctx = {
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        tools.push(definition)
      }),
    },
    systemPrompt: {
      section: vi.fn((section: SectionStub) => {
        sections.push(section)
        return () => {}
      }),
    },
  }

  return { ctx: ctx as unknown as Context, tools, sections }
}

/** Execution identity the report body never reads. */
const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

const VALID_CONFIG = readFileSync(new URL('../fixtures/gates.valid.yml', import.meta.url), 'utf8')

/** Throwaway workspaces, removed after each test. */
const roots: string[] = []

/** Create a throwaway workspace holding the sample gate config. */
function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'check-quality-gates-tool-'))
  roots.push(root)
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'gates.yml'), VALID_CONFIG)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** The manifest and the patch row, read from disk as the CLI reads them. */
function readManifestFacts(): {
  packageName: string
  entryId: string
  entryName: string
  resident: number
} {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string; dsh: { tokenBudget: { resident: number } } }
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)
  const nameMatch = /^\s*name:\s*(\S+)\s*$/m.exec(patch)
  return {
    packageName: packageJson.name,
    entryId: idMatch?.[1] ?? '',
    entryName: nameMatch?.[1] ?? '',
    resident: packageJson.dsh.tokenBudget.resident,
  }
}

describe('check_quality_gates plugin', () => {
  it('declares the host services it uses', () => {
    expect(name).toBe('tool-check-quality-gates')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one tool named check_quality_gates when applied', () => {
    const { ctx, tools } = createFakeContext()

    expect(() => apply(ctx)).not.toThrow()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('check_quality_gates')
    expect(tools[0]?.description).toContain('enforcement is "none"')
  })

  it('registers no system-prompt section, so its resident prompt cost is zero', () => {
    const { ctx, sections } = createFakeContext()

    apply(ctx)

    expect(sections).toHaveLength(0)
  })

  it('declares the three parameters the lookup needs', () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    // `defineTool` compiles the author-facing spec into a JSON schema at
    // registration time, so the definition carries properties + required.
    const parameters = tools[0]?.parameters as
      | { properties?: Record<string, unknown>, required?: string[] }
      | undefined

    expect(Object.keys(parameters?.properties ?? {}).toSorted())
      .toEqual(['changedFiles', 'configPath', 'cwd'])
    expect(parameters?.required).toEqual(['changedFiles'])
  })

  it('answers a real call from a real config file', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)
    const root = makeWorkspace()

    const result = await tools[0]?.execute(
      { changedFiles: ['packages/a/src/b.ts', 'README.md'], cwd: root },
      exec,
    ) as {
      changedFiles: string[]
      requiredGates: { id: string, command: string, reason: string, rawEvidenceRequired: string }[]
      source: string
      enforcement: string
      unmatched: string[]
      error: string | null
    }

    expect(result.requiredGates.map((gate) => gate.id)).toEqual(['typecheck', 'lint'])
    expect(result.requiredGates[0]?.command).toBe('pnpm run typecheck')
    expect(result.changedFiles).toEqual(['README.md', 'packages/a/src/b.ts'])
    expect(result.unmatched).toEqual(['README.md'])
    expect(result.source).toBe(join(root, '.dsh', 'gates.yml'))
    expect(result.enforcement).toBe('none')
    expect(result.error).toBeNull()
  })

  it('keeps the declared resident budget in step with the model-visible projection', () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    // Same basis as scripts/token-budget.mjs: the JSON of the projection the
    // harness sends, at the host token meter's fixed density of 4 chars/token,
    // plus this package's prompt-section text (none).
    const projection = {
      name: tools[0]?.name,
      description: tools[0]?.description,
      parameters: tools[0]?.parameters,
    }
    const chars = JSON.stringify(projection).length
    const resident = Math.ceil(chars / 4)

    expect(readManifestFacts().resident).toBe(resident)
  })
})

/**
 * The names a DSH plugin carries are derived from one another rather than chosen
 * one by one. This suite pins the derivation, so a rename cannot leave the
 * manifest, the patch row, the plugin name and the tool disagreeing.
 *
 *   npm package  soia-dsh-tool-check-quality-gates   vendor prefix + official dsh- marker
 *   entry id     tool-check-quality-gates            package name minus that prefix
 *   plugin name  tool-check-quality-gates            what the loader row declares
 *   tool name    check_quality_gates                 id minus the `tool-` kind prefix
 *   section      tool:check_quality_gates            "tool:" + the tool name (not registered)
 *
 * The last two steps follow the official packages: `dsh-tool-bash` registers the
 * tool `bash` and the section `tool:bash`, so the kind prefix stays with the
 * package and never reaches the model-facing name.
 */
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
    const { ctx, tools, sections } = createFakeContext()
    apply(ctx)

    const toolName = entryId.replace(/^tool-/, '').replaceAll('-', '_')
    const sectionName = `tool:${toolName}`

    expect(name).toBe(entryId)
    expect(tools[0]?.name).toBe(toolName)
    expect(sectionName).toBe('tool:check_quality_gates')
    // The derivation stops here: this package deliberately registers no section.
    expect(sections).toHaveLength(0)
  })
})
