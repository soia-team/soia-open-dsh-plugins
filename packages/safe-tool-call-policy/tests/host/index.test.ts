import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'
import { afterAll, describe, expect, it } from 'vitest'

import { apply, inject, name } from '../../src/index.ts'

/** One `tools/pre-execute` listener as the plugin registers it. */
type PreExecuteListener = (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>

/** A project root with no `.dsh/`, so the shipped rule set is the effective one. */
const PLAIN_PROJECT = mkdtempSync(join(tmpdir(), 'safe-tool-call-policy-wiring-'))

/** A project root whose policy file cannot be parsed, for the fail-open case. */
const BROKEN_PROJECT = fileURLToPath(new URL('../fixtures/project-broken-json/', import.meta.url))

/** A project root that disables two shipped rules. */
const QUIET_PROJECT = fileURLToPath(new URL('../fixtures/project-json/', import.meta.url))

afterAll(() => {
  rmSync(PLAIN_PROJECT, { recursive: true, force: true })
})

/**
 * Minimal host stub: records what `apply` registers and nothing else. It has no
 * `tools.register` and no `systemPrompt`, so an accidental tool or prompt
 * contribution shows up as a thrown TypeError instead of passing silently — the
 * same reason this package declares `dsh.tokenBudget.resident: 0`.
 */
function createFakeContext() {
  const listeners: PreExecuteListener[] = []
  const guards: ToolGuard[] = []
  const effects: (() => void)[] = []
  const warnings: string[] = []
  /** The plugin also reads the approval policy from the session event stream. */
  type SessionListener = (session: unknown, event: unknown) => void
  const sessionListeners: SessionListener[] = []

  const ctx = {
    // The health service extends cordis' `Service`, which publishes itself through
    // `ctx.reflect.provide`; the real host always has it, so the stub mirrors that
    // contract instead of letting the plugin take a different path under test.
    reflect: {
      provide: (name: string, value: unknown) => {
        (ctx as unknown as Record<string, unknown>)[name] = value
      },
    },
    on: (event: string, listener: PreExecuteListener | SessionListener): (() => boolean) => {
      // The plugin listens to exactly two events: the pre-execute waterfall, and
      // `session/event` for the approval policy it must respect per session.
      if (event === 'tools/pre-execute') listeners.push(listener as PreExecuteListener)
      else if (event === 'session/event') sessionListeners.push(listener as SessionListener)
      else throw new TypeError(`unexpected event: ${event}`)
      return () => true
    },
    effect: (execute: () => () => void, label?: string): (() => void) => {
      if (label === undefined) throw new TypeError('effect registered without a label')
      effects.push(execute())
      return () => {}
    },
    logger: {
      warn: (message: string): void => {
        warnings.push(message)
      },
    },
    sessionEvents: (sessionId: string, event: { type: string, data: unknown }): void => {
      for (const listener of sessionListeners) listener({ id: sessionId } as never, event as never)
    },
    tools: {
      guard: (guard: ToolGuard): (() => void) => {
        guards.push(guard)
        return () => {}
      },
    },
  }

  return { ctx: ctx as unknown as Context, listeners, guards, effects, warnings }
}

/** One pending call as the registry would hand it to a listener or guard. */
function fakeExecution(projectRoot: string, tool: string, argument: string): ToolExecution {
  return {
    name: tool,
    // `bash` is the tool whose text is matched; the agent supplies the project root.
    arguments: tool === 'bash' ? { command: argument } : { file_path: argument },
    agent: { session: { header: { cwd: projectRoot } } },
  } as unknown as ToolExecution
}

/** `next()` as the registry provides it: the other listeners' verdict. */
const next = (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' })

describe('safe-tool-call-policy plugin', () => {
  it('declares the host service it uses and no tool of its own', () => {
    expect(name).toBe('safe-tool-call-policy')
    expect(inject).toEqual(['tools'])
  })

  it('registers exactly one pre-execute listener and one deny guard, both on the plugin fiber', () => {
    const fake = createFakeContext()

    expect(() => apply(fake.ctx)).not.toThrow()
    expect(fake.listeners).toHaveLength(1)
    expect(fake.guards).toHaveLength(1)
    expect(fake.effects).toHaveLength(1)
  })

  it('asks before a rule with action ask, and carries the remedy', async () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    const decision = await fake.listeners[0]?.(
      fakeExecution(PLAIN_PROJECT, 'bash', 'git stash push -m wip'),
      next,
    )

    if (decision?.kind !== 'ask') throw new Error(`expected an ask decision, got ${decision?.kind}`)

    expect(decision.reason).toContain('rule: git-danger')
    expect(decision.reason).toContain('--only <pathspec>')
  })

  it('delegates to the next listener for a call no rule matches', async () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    let delegated = false
    const decision = await fake.listeners[0]?.(
      fakeExecution(PLAIN_PROJECT, 'bash', 'pnpm vitest run packages/x'),
      () => {
        delegated = true
        return Promise.resolve({ kind: 'allow' })
      },
    )

    expect(delegated).toBe(true)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('denies through the monotonic guard, which no listener can undo', () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    const reason = fake.guards[0]?.(fakeExecution(PLAIN_PROJECT, 'bash', 'rm -rf ~/.myapp/cache'))

    expect(reason).toContain('rule: data-root-write')
    expect(reason).toContain('isolated config or data-home setting')
  })

  it('leaves the guard silent for a permitted call', () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    expect(fake.guards[0]?.(fakeExecution(PLAIN_PROJECT, 'write', 'src/index.ts'))).toBeUndefined()
    expect(fake.warnings).toEqual([])
  })

  it('fails open and warns when the project policy cannot be parsed', () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    const reason = fake.guards[0]?.(fakeExecution(BROKEN_PROJECT, 'bash', 'rm -rf ~/.myapp/cache'))

    expect(reason).toBeUndefined()
    expect(fake.warnings.join('\n')).toContain('fail-open')
  })

  it('stands both arms down in a project that disables the matching rules', async () => {
    const fake = createFakeContext()
    apply(fake.ctx)

    const denied = fake.guards[0]?.(fakeExecution(QUIET_PROJECT, 'bash', 'cli --token=abcd1234efgh'))
    const asked = await fake.listeners[0]?.(fakeExecution(QUIET_PROJECT, 'bash', 'npm publish'), next)

    expect(denied).toBeUndefined()
    expect(asked).toEqual({ kind: 'allow' })
  })
})

/** The vendor prefix every package in this repository carries. */
const PACKAGE_PREFIX = 'soia-dsh-'

/** Read the package manifest and the patch row from disk, as the CLI sees them. */
function readManifestFacts(): {
  packageName: string
  entryId: string
  entryName: string
  resident: number
} {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { name: string, dsh?: { tokenBudget?: { resident?: number } } }
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')

  return {
    packageName: manifest.name,
    entryId: /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)?.[1] ?? '',
    entryName: /^\s*name:\s*(\S+)\s*$/m.exec(patch)?.[1] ?? '',
    resident: manifest.dsh?.tokenBudget?.resident ?? -1,
  }
}

/**
 * The names a DSH bundle carries are derived from one another rather than
 * chosen one by one. This suite pins the derivation, and pins the one budget
 * number this package claims:
 *
 *   npm package  soia-dsh-safe-tool-call-policy   vendor prefix + official dsh- marker
 *   entry id     safe-tool-call-policy            package name minus that prefix
 *   plugin name  safe-tool-call-policy            what the loader row declares
 *
 * The chain stops at the id: a `<capability>-policy` plugin, like the official
 * `dsh-spill-policy`, registers no tool and no prompt section, so there is no
 * tool name and no section name to derive.
 */
describe('name derivation and resident budget', () => {
  it('derives the entry id from the package name by dropping the vendor prefix', () => {
    const { packageName, entryId } = readManifestFacts()

    expect(packageName.startsWith(PACKAGE_PREFIX)).toBe(true)
    expect(entryId).toBe(packageName.slice(PACKAGE_PREFIX.length))
    expect(name).toBe(entryId)
  })

  it('keeps the patch row name equal to the package name', () => {
    const { packageName, entryName } = readManifestFacts()

    expect(entryName).toBe(packageName)
  })

  it('declares zero resident tokens, because it registers no tool and no prompt section', () => {
    const { resident } = readManifestFacts()
    const fake = createFakeContext()

    expect(resident).toBe(0)
    expect(() => apply(fake.ctx)).not.toThrow()
  })
})
