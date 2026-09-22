import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluateCall } from '../../src/shared/evaluate.ts'
import type { PolicyRule } from '../../src/shared/types.ts'
import { INCIDENTS } from '../fixtures/incidents.ts'

/**
 * Replay the intercepted commands against the fixed rules.
 *
 * The corpus in `rule-corpus.test.ts` guards the rules' intent; this file guards
 * the *incidents*. Every case is a shape that a real session was stopped for, so
 * a change that reintroduces the noise fails here with the incident attached.
 */
const RULES: readonly PolicyRule[] = JSON.parse(
  readFileSync(new URL('../../danger-patterns.json', import.meta.url), 'utf8'),
) as PolicyRule[]

/** Severity ranking, so "still stopped" is comparable across actions. */
const SEVERITY: Record<string, number> = { allow: 0, ask: 1, deny: 2 }

describe('incident replay', () => {
  for (const incident of INCIDENTS) {
    it(`${incident.expect}: ${incident.command.split('\n')[0]?.slice(0, 62)}`, () => {
      const decision = evaluateCall({ tool: 'bash', text: incident.command }, RULES)

      expect(decision.action, `${incident.why} (decided by ${decision.ruleId ?? 'nothing'})`)
        .toBe(incident.expect)
    })
  }

  it('stops every hazard at least as strictly as it did before the fix', () => {
    const hazards = INCIDENTS.filter((incident) => incident.expect !== 'allow')
    expect(hazards.length).toBeGreaterThan(4)
    for (const hazard of hazards) {
      const decision = evaluateCall({ tool: 'bash', text: hazard.command }, RULES)
      expect(SEVERITY[decision.action] ?? 0, hazard.command).toBeGreaterThanOrEqual(SEVERITY[hazard.expect] ?? 0)
    }
  })

  it('no longer stops any read-only diagnostic', () => {
    // The headline the operator asked for: read access back.
    const diagnostics = INCIDENTS.filter((incident) => incident.why.startsWith('incident:'))
    const stopped = diagnostics.filter((incident) =>
      evaluateCall({ tool: 'bash', text: incident.command }, RULES).action !== 'allow')
    expect(stopped.map((incident) => incident.command)).toEqual([])
  })
})
