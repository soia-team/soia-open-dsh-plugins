import { readFileSync } from 'node:fs'

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'

import { apply, inject, name } from '../../src/index.ts'
import { liveTaskProjectionDefinition } from '../../src/host/live-task-projection.ts'
import { LiveTaskTracker } from '../../src/host/live-task-tracker.ts'
import type { LiveTaskStore } from '../../src/host/live-task-store.ts'
import { LIVE_TASK_PROJECTION_KEY } from '../../src/shared/projection.ts'
import type { LiveTaskState } from '../../src/shared/types.ts'

/** One durable event as the session store publishes it. */
interface SessionEventStub {
  type: string
  seq: number
  time: number
  data: unknown
}

/** The event type the projection unit's `apply` accepts. */
type ProjectionEvent = Parameters<typeof liveTaskProjectionDefinition.apply>[1]

/** The session header the projection unit's `init` accepts. */
type ProjectionHeader = Parameters<typeof liveTaskProjectionDefinition.init>[0]

/** One durable event observation. */
function event(type: string, seq: number, data: unknown, time = seq * 1000): SessionEventStub {
  return { type, seq, time, data }
}

/** The same event, typed as the projection unit sees it. */
function projectionEvent(type: string, seq: number, data: unknown): ProjectionEvent {
  return event(type, seq, data) as unknown as ProjectionEvent
}

/** A session identity the store treats as opaque. */
function session(id: string): SessionId {
  return id as SessionId
}

/**
 * Minimal host stub: records what `apply` registers and lets a test dispatch
 * the three feeds by hand. It deliberately implements only the members this
 * plugin touches, so an accidental dependency on any other host service shows
 * up as a thrown TypeError instead of passing silently.
 *
 * `reflect.provide` mirrors the real registry in the one way the plugin cares
 * about: the service becomes reachable as a member of the context.
 */
function createFakeContext() {
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const provided = new Map<string, unknown>()
  const registered: unknown[] = []

  const ctx: Record<string, unknown> = {
    on: (eventName: string, listener: (...args: never[]) => void) => {
      const existing = listeners.get(eventName) ?? []
      existing.push(listener)
      listeners.set(eventName, existing)
      return () => true
    },
    logger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    agents: {
      list: () => [...agentHandles.keys()].map((sessionId) => ensureAgent(sessionId)),
    },
    reflect: {
      provide: (serviceName: string, value: unknown) => {
        provided.set(serviceName, value)
        ctx[serviceName] = value
      },
    },
    sessionProjections: {
      register: (definition: unknown) => {
        registered.push(definition)
        return () => {}
      },
    },
  }

  const emit = (eventName: string, ...args: unknown[]): void => {
    // A session event implies a live agent, and the store attaches to that
    // agent when it sees one: materialize the handle first so the attach lands.
    if (eventName === 'session/event') ensureAgent((args[0] as { id: string }).id)
    for (const listener of listeners.get(eventName) ?? []) {
      (listener as unknown as (...payload: unknown[]) => void)(...args)
    }
  }

  // `agent/assistant-stream` is agent-scoped, so the real plugin subscribes on
  // each agent's own context. The stub mirrors that: an agent handed to
  // `agent/created` gets its own listener table, and `emitStream` dispatches
  // into it the way the host's scope-filtered dispatch would.
  const agentListeners = new Map<string, Map<string, ((...args: never[]) => void)[]>>()
  const agentHandles = new Map<string, Record<string, unknown>>()

  /** Materialize (once) the agent handle the host registry would hand out. */
  const ensureAgent = (sessionId: string): Record<string, unknown> => {
    const existing = agentHandles.get(sessionId)
    if (existing !== undefined) return existing
    const table = new Map<string, ((...args: never[]) => void)[]>()
    agentListeners.set(sessionId, table)
    const handle: Record<string, unknown> = {
      session: { id: sessionId },
      ctx: {
        on: (eventName: string, listener: (...args: never[]) => void) => {
          const listenersForEvent = table.get(eventName) ?? []
          listenersForEvent.push(listener)
          table.set(eventName, listenersForEvent)
          return () => true
        },
        effect: (callback: () => unknown) => callback(),
      },
    }
    agentHandles.set(sessionId, handle)
    return handle
  }

  /** Dispatch one stream frame to the listener the plugin attached for a session. */
  const emitStream = (sessionId: string, frame: unknown): void => {
    ensureAgent(sessionId)
    for (const listener of agentListeners.get(sessionId)?.get('agent/assistant-stream') ?? []) {
      (listener as unknown as (payload: unknown) => void)({ frame })
    }
  }

  return { ctx: ctx as unknown as Context, emit, emitStream, provided, registered, listeners }
}

/** Apply the plugin and hand back the store it registered as `ctx.liveTasks`. */
function applyHost(ctx: Context): LiveTaskStore {
  apply(ctx)
  return (ctx as unknown as { liveTasks: LiveTaskStore }).liveTasks
}

/** A fresh host with the plugin applied and the session store captured. */
function host(): ReturnType<typeof createFakeContext> & { liveTasks: LiveTaskStore } {
  const harness = createFakeContext()
  return { ...harness, liveTasks: applyHost(harness.ctx) }
}

/** Fold one durable event into the projection unit as the registry would. */
function foldProjection(state: LiveTaskState, type: string, seq: number, data: unknown): LiveTaskState {
  return liveTaskProjectionDefinition.apply(state, projectionEvent(type, seq, data)) as LiveTaskState
}

describe('ui-live-tasks plugin', () => {
  it('declares the plugin name and the host service it uses', () => {
    expect(name).toBe('ui-live-tasks')
    expect(inject).toEqual(['sessionProjections', 'agents'])
  })

  it('registers the liveTasks service and exactly one projection unit when applied', () => {
    const { ctx, provided, registered } = createFakeContext()

    expect(() => apply(ctx)).not.toThrow()
    expect([...provided.keys()]).toEqual(['liveTasks'])
    expect(registered).toHaveLength(1)
    expect(registered[0]).toBe(liveTaskProjectionDefinition)
  })

  it('subscribes to both feeds it derives from, and to session disposal', () => {
    const { ctx, listeners } = createFakeContext()
    apply(ctx)

    expect([...listeners.keys()].toSorted())
      .toEqual(['session/disposed', 'session/event'])
  })

  it('serves the projection key the browser half reads', () => {
    const { ctx, registered } = createFakeContext()
    apply(ctx)

    expect((registered[0] as { key: string }).key).toBe(LIVE_TASK_PROJECTION_KEY)
    expect(LIVE_TASK_PROJECTION_KEY).toBe('liveTask')
  })
})

describe('liveTasks host surface', () => {
  it('folds durable session events into this session state', () => {
    const { emit,  liveTasks } = host()
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))
    emit('session/event', { id: 'session-1' }, event(
      'tool/call',
      3,
      { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' },
    ))

    const state = liveTasks.read(session('session-1'))

    expect(state.running).toBe(true)
    expect(state.lastTool?.name).toBe('bash')
    expect(state.lastEvent?.type).toBe('tool/call')
  })

  it('keeps one state per session', () => {
    const { emit,  liveTasks } = host()
    emit('session/event', { id: 'a' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'b' }, event('turn/start', 1, { turn: 2 }))

    expect(liveTasks.snapshot().size).toBe(2)
    expect(liveTasks.read(session('a')).turn).toBe(1)
    expect(liveTasks.read(session('b')).turn).toBe(2)
  })

  it('returns the shared initial state for a session it has never seen', () => {
    const { liveTasks } = host()

    expect(liveTasks.read(session('session-unknown')).updatedAt).toBeNull()
    expect(liveTasks.snapshot().size).toBe(0)
  })

  it('counts transient model text for the attempt its start frame announced', () => {
    const { emit, liveTasks, emitStream } = host()
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))
    emitStream('session-1', { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 })
    emitStream('session-1', {
        type: 'chunk',
        attemptId: 'a1',
        revision: 1,
        index: 0,
        time: 3000,
        chunk: { type: 'text-delta', index: 0, text: 'hello' },
      })

    expect(liveTasks.read(session('session-1')).streamedTextLength).toBe(5)
  })

  it('drops a chunk whose attempt no start frame announced', () => {
    const { emit, liveTasks, emitStream } = host()
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))
    emitStream('session-1', {
        type: 'chunk',
        attemptId: 'never-started',
        revision: 1,
        index: 0,
        time: 3000,
        chunk: { type: 'text-delta', index: 0, text: 'hello' },
      })

    expect(liveTasks.read(session('session-1')).streamedTextLength).toBe(0)
  })

  it('stops counting once the attempt ends', () => {
    const { emit, liveTasks, emitStream } = host()
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))
    emitStream('session-1', { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 })
    emitStream('session-1', { type: 'end', attemptId: 'a1', revision: 1, index: 0, outcome: { kind: 'abandoned' } })
    emitStream('session-1', {
        type: 'chunk',
        attemptId: 'a1',
        revision: 1,
        index: 1,
        time: 3000,
        chunk: { type: 'text-delta', index: 0, text: 'hello' },
      })

    expect(liveTasks.read(session('session-1')).streamedTextLength).toBe(0)
  })

  it('ignores a non-text model chunk', () => {
    const { emit, liveTasks, emitStream } = host()
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))
    emitStream('session-1', { type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 })
    emitStream('session-1', {
        type: 'chunk',
        attemptId: 'a1',
        revision: 1,
        index: 0,
        time: 3000,
        chunk: { type: 'finish', reason: { kind: 'stop' } },
      })

    expect(liveTasks.read(session('session-1')).streamedTextLength).toBe(0)
  })

  it('notifies subscribers once per real change and not for a duplicate', () => {
    const { emit, liveTasks } = host()
    const seen: (number | null)[] = []
    liveTasks.onChanged((_sessionId, state) => {
      seen.push(state?.updatedAt ?? null)
    })

    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))

    expect(seen).toEqual([1000, 2000])
  })

  it('releases a disposed session and says so with an undefined state', () => {
    const { emit, liveTasks } = host()
    const seen: (string | undefined)[] = []
    liveTasks.onChanged((sessionId, state) => {
      seen.push(state === undefined ? undefined : sessionId)
    })

    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    emit('session/disposed', { id: 'session-1' })

    expect(liveTasks.snapshot().size).toBe(0)
    expect(seen).toEqual(['session-1', undefined])
  })

  it('stops notifying a listener that unsubscribed', () => {
    const { emit, liveTasks } = host()
    const listener = vi.fn()
    const dispose = liveTasks.onChanged(listener)

    emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    dispose()
    emit('session/event', { id: 'session-1' }, event('step/start', 2, { turn: 1, step: 1 }))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('contains a failing listener instead of dropping the listeners after it', () => {
    const { emit, liveTasks } = host()
    const after = vi.fn()
    liveTasks.onChanged(() => {
      throw new Error('listener bug')
    })
    liveTasks.onChanged(after)

    expect(() => {
      emit('session/event', { id: 'session-1' }, event('turn/start', 1, { turn: 1 }))
    }).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })
})

describe('liveTask projection unit', () => {
  const header = {} as ProjectionHeader

  it('starts from the shared initial state', () => {
    const initial = liveTaskProjectionDefinition.init(header, 0)

    expect(initial.running).toBe(false)
    expect(initial.seq).toBe(0)
    expect(initial.updatedAt).toBeNull()
  })

  it('folds committed events with the shared reducer', () => {
    const initial = liveTaskProjectionDefinition.init(header, 0)
    const next = foldProjection(initial, 'turn/start', 1, { turn: 1 })

    expect(next.running).toBe(true)
    expect(next.turn).toBe(1)
    expect(next).not.toBe(initial)
  })

  it('returns the same reference for an event it ignores, so the registry stays quiet', () => {
    const opened = foldProjection(liveTaskProjectionDefinition.init(header, 0), 'turn/start', 1, {
      turn: 1,
    })
    const replay = foldProjection(opened, 'turn/start', 1, { turn: 1 })

    expect(replay).toBe(opened)
  })

  it('reuses one view object per state reference', () => {
    const initial = liveTaskProjectionDefinition.init(header, 0)

    expect(liveTaskProjectionDefinition.wire.view(initial))
      .toBe(liveTaskProjectionDefinition.wire.view(initial))
  })

  it('keeps the transient-only fields off the wire', () => {
    const state = foldProjection(liveTaskProjectionDefinition.init(header, 0), 'turn/start', 1, {
      turn: 1,
    })
    const view = liveTaskProjectionDefinition.wire.view(state) as unknown as Record<string, unknown>

    expect(Object.keys(view).toSorted()).toEqual([
      'actions',
      'endedReason',
      'failuresTotal',
      'health',
      'lastEvent',
      'lastTool',
      'openTools',
      'recent',
      'running',
      'seq',
      'step',
      'streamedAt',
      'timeline',
      'toolCallsInTurn',
      'toolCallsTotal',
      'toolsAvailable',
      'turn',
      'turns',
      'turnsTotal',
      'updatedAt',
      'usage',
    ])
    expect(liveTaskProjectionDefinition.wire.viewSchema.safeParse(view).success).toBe(true)
  })

  it('rejects a value that does not match either schema', () => {
    const state = foldProjection(liveTaskProjectionDefinition.init(header, 0), 'turn/start', 1, {
      turn: 1,
    })
    const view = liveTaskProjectionDefinition.wire.view(state)
    const widened = { ...view, streamedTextLength: 4 }

    expect(liveTaskProjectionDefinition.stateSchema.safeParse({ running: 'yes' }).success).toBe(false)
    expect(liveTaskProjectionDefinition.stateSchema.safeParse(view).success).toBe(false)
    expect(liveTaskProjectionDefinition.wire.viewSchema.safeParse(widened).success).toBe(false)
  })
})

describe('live-task tracker', () => {
  it('keys state by session and reports the shared initial state for unknown keys', () => {
    const tracker = new LiveTaskTracker()

    tracker.observe('a', { kind: 'event', event: event('turn/start', 1, { turn: 1 }) })
    tracker.observe('b', { kind: 'event', event: event('turn/start', 1, { turn: 2 }) })

    expect(tracker.size).toBe(2)
    expect(tracker.read('a').turn).toBe(1)
    expect(tracker.read('b').turn).toBe(2)
    expect(tracker.read('c').updatedAt).toBeNull()
  })

  it('forgets one session without touching the others', () => {
    const tracker = new LiveTaskTracker()
    tracker.observe('a', { kind: 'event', event: event('turn/start', 1, { turn: 1 }) })
    tracker.observe('b', { kind: 'event', event: event('turn/start', 1, { turn: 2 }) })

    expect(tracker.forget('a')).toBe(true)
    expect(tracker.forget('a')).toBe(false)
    expect([...tracker.snapshot().keys()]).toEqual(['b'])
  })

  it('hands out a detached snapshot', () => {
    const tracker = new LiveTaskTracker()
    tracker.observe('a', { kind: 'event', event: event('turn/start', 1, { turn: 1 }) })

    const snapshot = tracker.snapshot() as Map<string, unknown>
    snapshot.delete('a')

    expect(tracker.snapshot().size).toBe(1)
  })
})

/**
 * A client-bundle package carries one more derived name than a host-only one:
 * the npm package name, the Loader row id, the plugin name, and the projection
 * key the two halves agree on. This suite pins every step, so a rename cannot
 * leave the manifest, the patch row, the plugin name, and the browser half
 * disagreeing with each other.
 *
 *   npm package  soia-dsh-client-ui-live-tasks   vendor prefix + client face + name
 *   entry id     ui-live-tasks                   package name minus `soia-dsh-client-`
 *   plugin name  ui-live-tasks                   what the loader row declares
 *   projection   liveTask                        registered by the host, read by the browser
 *
 * The client-face step follows the official packages: `@deepseek-ai/dsh-client-ui-jobs`
 * loads under `ui-jobs` in the shipped Web composition's `cordis.patch.yml`, so the
 * `client-` marker belongs to the package name and never reaches the Loader id.
 */
describe('name derivation', () => {
  /** The vendor prefix plus the client face marker a browser bundle drops. */
  const CLIENT_PACKAGE_PREFIX = 'soia-dsh-client-'

  /** One package manifest as the CLI reads it. */
  interface Manifest {
    name: string
    files: string[]
    exports: Record<string, { types?: string, default?: string }>
    dsh: {
      bundle?: { patch?: string }
      client?: { inject?: string[], platform?: string }
      compatibility?: { dsh?: string }
      tokenBudget?: { resident?: number }
    }
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  /** Read the manifest and the patch row from disk, as the CLI sees them. */
  function readManifestFacts(): {
    manifest: Manifest
    entryId: string
    entryName: string
  } {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as Manifest
    const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(patch)
    const nameMatch = /^\s*name:\s*(\S+)\s*$/m.exec(patch)
    return {
      manifest,
      entryId: idMatch?.[1] ?? '',
      entryName: nameMatch?.[1] ?? '',
    }
  }

  it('derives the entry id from the package name by dropping the client face marker', () => {
    const { manifest, entryId } = readManifestFacts()

    expect(manifest.name.startsWith(CLIENT_PACKAGE_PREFIX)).toBe(true)
    expect(entryId).toBe(manifest.name.slice(CLIENT_PACKAGE_PREFIX.length))
  })

  it('keeps the patch row name equal to the package name', () => {
    const { manifest, entryName } = readManifestFacts()

    expect(entryName).toBe(manifest.name)
  })

  it('keeps the plugin name equal to the entry id', () => {
    const { entryId } = readManifestFacts()

    expect(name).toBe(entryId)
  })

  it('declares the browser half the way the client module system discovers it', () => {
    const { manifest } = readManifestFacts()

    expect(manifest.dsh.client?.platform).toBe('web')
    // The module table entries the browser half resolves at runtime: the
    // conversation surface that owns the view slot, the projection-bearing
    // session kit, the primitives it renders with, and the locale registry.
    expect(manifest.dsh.client?.inject).toEqual([
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-session',
    ])
    expect(manifest.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './lib/client.js',
    })
    expect(manifest.files).toContain('lib/client.js')
  })

  it('ships the patch row and both built entries', () => {
    const { manifest } = readManifestFacts()

    expect(manifest.dsh.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(manifest.files).toContain('lib/index.js')
    expect(manifest.files).toContain('lib/types/**/*.d.ts')
    expect(manifest.exports['.']).toEqual({
      types: './lib/types/index.d.ts',
      default: './lib/index.js',
    })
  })

  it('declares a zero resident token budget, because nothing here is model-visible', () => {
    const { manifest } = readManifestFacts()

    expect(manifest.dsh.tokenBudget?.resident).toBe(0)
    expect(manifest.dsh.compatibility?.dsh).toBe('>=0.1.0-rc.8 <0.2.0')
  })

  it('mirrors every peer dependency in devDependencies at the same range', () => {
    const { manifest } = readManifestFacts()
    const peers = Object.entries(manifest.peerDependencies ?? {})

    expect(peers.length).toBeGreaterThan(0)
    for (const [dependency, range] of peers) {
      expect(manifest.devDependencies?.[dependency]).toBe(range)
    }
  })

  it('names the client packages the browser half imports', () => {
    const { manifest } = readManifestFacts()

    for (const dependency of [
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-session',
      '@deepseek-ai/dsh-client-ui-slots',
    ]) {
      expect(manifest.devDependencies?.[dependency]).toBeDefined()
    }
  })
})
