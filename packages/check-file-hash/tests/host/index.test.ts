/**
 * Host-entry tests: what the plugin registers, and the name derivation that ties
 * the manifest, the patch row, the plugin and the tool together.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apply, inject, name } from '../../src/index.ts'
import type { HashOutcome } from '../../src/shared/types.ts'

/**
 * Minimal host stub: records what `apply` registers. It deliberately implements
 * only the members this plugin touches, so an accidental dependency on any other
 * host service shows up as a thrown TypeError instead of passing silently.
 */
function createFakeContext() {
  const tools: ToolDefinition[] = []

  const ctx = {
    tools: {
      register: vi.fn((definition: ToolDefinition) => {
        tools.push(definition)
      }),
    },
  }

  return { ctx: ctx as unknown as Context, tools }
}

/** Execution identity the body never reads. */
const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

/** Read the package manifest and the patch row from disk, as the CLI sees them. */
function readManifestFacts(): { packageName: string, entryId: string, entryName: string } {
  const packageJson = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string }
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)
  const nameMatch = /^\s*name:\s*(\S+)\s*$/m.exec(patch)
  return {
    packageName: packageJson.name,
    entryId: idMatch?.[1] ?? '',
    entryName: nameMatch?.[1] ?? '',
  }
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'check-file-hash-entry-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('check_file_hash plugin', () => {
  it('declares the host service it uses', () => {
    expect(name).toBe('tool-check-file-hash')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one tool named check_file_hash when applied', () => {
    const { ctx, tools } = createFakeContext()

    expect(() => apply(ctx)).not.toThrow()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('check_file_hash')
  })

  it('declares the two parameters the check needs', () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    // `defineTool` compiles the author-facing spec into a JSON schema at
    // registration time, so the definition carries properties + required.
    const parameters = tools[0]?.parameters as
      | { properties?: Record<string, unknown>, required?: string[] }
      | undefined

    expect(Object.keys(parameters?.properties ?? {}).toSorted()).toEqual(['evidenceDir', 'paths'])
    expect(parameters?.required).toEqual(['paths'])
  })

  it('hashes a real file and validates against its own declared output schema', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)
    const path = join(root, 'artifact.txt')
    await writeFile(path, 'abc')

    const definition = tools[0]
    const result = await definition?.execute({ paths: [path] }, exec) as HashOutcome

    expect(validateJsonSchemaValue(definition?.output.schema as JsonSchemaNode, result, 'result'))
      .toEqual([])
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe(path)
    expect(result.files[0]?.hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(result.totalBytes).toBe(3)
  })

  it('writes an evidence file under evidenceDir and names it in the result', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)
    const path = join(root, 'artifact.txt')
    await writeFile(path, 'abc')
    const evidenceDir = join(root, 'evidence')

    const result = await tools[0]?.execute({ paths: [path], evidenceDir }, exec) as HashOutcome

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.evidencePath?.startsWith(evidenceDir)).toBe(true)
    expect(result.evidenceError).toBeUndefined()
  })

  it('returns a typed error instead of a partial file list when a path is missing', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    const result = await tools[0]?.execute({ paths: [join(root, 'absent.txt')] }, exec) as HashOutcome

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('not_found')
    expect(result.path).toBe(join(root, 'absent.txt'))
  })
})

/**
 * The names a DSH plugin carries are derived from one another rather than chosen
 * one by one. This suite pins the derivation, so a rename cannot leave the
 * manifest, the patch row, the plugin and the tool disagreeing with each other.
 *
 *   npm package  soia-dsh-tool-check-file-hash   vendor prefix + official dsh- marker
 *   entry id     tool-check-file-hash            package name minus that prefix
 *   plugin name  tool-check-file-hash            what the loader row declares
 *   tool name    check_file_hash                 id minus the `tool-` kind prefix
 *
 * The last step follows the official packages: `dsh-tool-bash` registers the tool
 * `bash`, so the kind prefix stays with the package and never reaches the
 * model-facing name. This package registers no prompt section, so no `tool:` name
 * is part of the chain.
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
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    const toolName = entryId.replace(/^tool-/, '').replaceAll('-', '_')

    expect(name).toBe(entryId)
    expect(tools[0]?.name).toBe(toolName)
  })

  it('declares a resident token budget for the tool it registers', async () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dsh?: { tokenBudget?: { resident?: number } } }
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    const tool = tools[0]
    const projection = JSON.stringify({
      name: tool?.name,
      description: tool?.description,
      parameters: tool?.parameters,
    })

    expect(manifest.dsh?.tokenBudget?.resident).toBe(Math.ceil(projection.length / 4))
  })
})
