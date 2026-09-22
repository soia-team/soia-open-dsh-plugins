import { readFileSync } from 'node:fs'

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

import {
  apply,
  CHECK_UI_SIZE_SECTION,
  CHECK_UI_SIZE_SECTION_ORDER,
  inject,
  name,
} from '../../src/index.ts'

/** One prompt section as the plugin hands it to the host registry. */
interface SectionStub {
  name: string
  order: number
  text: string
}

/**
 * Minimal host stub: records what `apply` registers. It deliberately implements
 * only the two members this plugin touches, so an accidental dependency on any
 * other host service shows up as a thrown TypeError instead of passing silently.
 */
function createFakeContext() {
  const tools: ToolDefinition[] = []
  const sections: SectionStub[] = []

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
    systemPrompt: {
      section: vi.fn((section: SectionStub) => {
        sections.push(section)
        return () => {}
      }),
    },
  }

  return { ctx: ctx as unknown as Context, tools, sections }
}

/** Execution identity the placeholder body never reads. */
const exec = { signal: new AbortController().signal } as unknown as ToolRunContext

describe('check_ui_size plugin', () => {
  it('declares the host services it uses', () => {
    expect(name).toBe('tool-check-ui-size')
    expect(inject).toEqual(['tools', 'systemPrompt'])
  })

  it('registers exactly one tool named check_ui_size when applied', () => {
    const { ctx, tools } = createFakeContext()

    expect(() => apply(ctx)).not.toThrow()
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('check_ui_size')
  })

  it('contributes the measurement rule as one named prompt section', () => {
    const { ctx, sections } = createFakeContext()

    apply(ctx)

    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(CHECK_UI_SIZE_SECTION)
    expect(sections[0]?.order).toBe(CHECK_UI_SIZE_SECTION_ORDER)
    expect(sections[0]?.text).toContain('check_ui_size')
  })

  it('declares the four parameters the measurement needs', () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    // `defineTool` compiles the author-facing spec into a JSON schema at
    // registration time, so the definition carries properties + required.
    const parameters = tools[0]?.parameters as
      | { properties?: Record<string, unknown>, required?: string[] }
      | undefined

    expect(Object.keys(parameters?.properties ?? {}).toSorted())
      .toEqual(['expectedHeight', 'expectedWidth', 'selector', 'url'])
    expect(parameters?.required).toEqual(['url', 'selector'])
  })

  it('returns a typed error rather than inventing a measurement when nothing is reachable', async () => {
    const { ctx, tools } = createFakeContext()
    apply(ctx)

    const result = await tools[0]?.execute(
      { url: 'http://127.0.0.1:1/never-listening', selector: '#panel' },
      exec,
    ) as { status: string; code?: string }

    // Without a browser the core reports browser_missing; with one it reports
    // navigation_failed. Both are typed failures — never a fake number.
    expect(result.status).toBe('error')
    expect(['browser_missing', 'navigation_failed']).toContain(result.code)
  })
})

/**
 * The four names a DSH plugin carries are derived from one another rather than
 * chosen one by one. This suite pins the derivation, so a rename cannot leave the
 * manifest, the patch row, the plugin name, the tool and the prompt section
 * disagreeing with each other.
 *
 *   npm package  soia-dsh-tool-check-ui-size   vendor prefix + official dsh- marker
 *   entry id     tool-check-ui-size            package name minus that prefix
 *   plugin name  tool-check-ui-size            what the loader row declares
 *   tool name    check_ui_size                 id minus the `tool-` kind prefix
 *   section      tool:check_ui_size            "tool:" + the tool name
 *
 * The last two steps follow the official packages: `dsh-tool-bash` registers the
 * tool `bash` and the section `tool:bash`, so the kind prefix stays with the
 * package and never reaches the model-facing name.
 */
describe('name derivation', () => {
  const PACKAGE_PREFIX = 'soia-dsh-'

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

    expect(name).toBe(entryId)
    expect(tools[0]?.name).toBe(toolName)
    // `dsh-tool-bash` registers the section `tool:bash`: "tool:" + tool name.
    expect(sections[0]?.name).toBe(`tool:${toolName}`)
  })
})
