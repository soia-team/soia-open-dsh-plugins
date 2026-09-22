import { describe, expect, it } from 'vitest'

import { QualityGatesHealth, QualityGates_HEALTH_SERVICE } from '../../src/host/health.ts'

/**
 * The self-check counters are the only place this package can say what it has
 * been doing, so they are pinned: a caller that reads them must be able to trust
 * the numbers, and the snapshot must not be a live window into the service.
 */
function fakeContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    reflect: {
      provide: (name: string, value: unknown) => {
        ctx[name] = value
      },
    },
  }
  return ctx
}

describe('runtime self-check', () => {
  it('publishes a service under a stable name', () => {
    const ctx = fakeContext()
    new QualityGatesHealth(ctx as never)

    expect(QualityGates_HEALTH_SERVICE).toBe('checkQualityGatesHealth')
    expect(ctx['checkQualityGatesHealth']).toBeDefined()
  })

  it('counts calls and failures, and reports nothing before the first call', () => {
    const health = new QualityGatesHealth(fakeContext() as never)

    expect(health.snapshot()).toMatchObject({ calls: 0, failures: 0, lastCallAt: null, lastFailureAt: null })

    health.record(false, 1_000)
    health.record(true, 2_000)

    expect(health.snapshot()).toMatchObject({ calls: 2, failures: 1, lastCallAt: 2_000, lastFailureAt: 2_000 })
  })

  it('hands out a frozen snapshot rather than a live view', () => {
    const health = new QualityGatesHealth(fakeContext() as never)
    const snapshot = health.snapshot()
    health.record(false, 3_000)

    expect(snapshot.calls).toBe(0)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })
})
