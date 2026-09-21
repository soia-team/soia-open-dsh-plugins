/**
 * Skill-usage classification tests.
 *
 * One case per verdict, driven through the real extraction path over hand-built
 * event rows, plus the degradation cases: no catalog event at all, an empty
 * catalog, a failed load, and a replacement catalog that retires an older name.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  SKILL_TOOL_NAME,
  classifySession,
  classifySkill,
  collectSkillUsage,
  extractCatalog,
  extractSkillLoads,
  extractToolNames,
  normalizeApplicableSkills,
  renderEvidenceReport,
  summarizeCatalog,
  writeEvidenceReport,
} from '../../src/host/skills.ts'
import type { SessionAnalysis, SessionEvent } from '../../src/shared/types.ts'
import {
  DEFAULT_CATALOG,
  assistantMessageEvent,
  catalogEvent,
  headerEvent,
  otherToolCallEvent,
  skillCallEvent,
  skillErrorResultEvent,
  skillResultEvent,
} from '../fixtures/session-log.ts'

/** Directories created by the current test, removed afterwards. */
const created: string[] = []
const NOW = '2026-01-02T03:04:05.678Z'

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Wrap events as the analysis object the classifier consumes. */
function analysisOf(events: SessionEvent[]): SessionAnalysis {
  return { sessionPath: '/fixture/session.v3.jsonl.zstd', events, malformedLineCount: 0, frameCount: 1, truncatedTail: false }
}

/** Collect evidence straight from a list of events. */
function evidenceOf(events: SessionEvent[]) {
  return collectSkillUsage(analysisOf(events))
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

describe('the five verdicts and the unreported case', () => {
  it('ok: the expected skill is in the catalog, loaded, and work followed', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)

    expect(evidence.calledSkills).toEqual(['alpha-protocol'])
    expect(evidence.loads[0]?.usedAfterLoad).toBe(true)
    expect(classifySkill('alpha-protocol', {
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })).toBe('ok')
  })

  it('not_in_catalog: the expected skill was never offered by this session', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['delta-unknown', 'epsilon-missing'],
    })

    expect(result.verdict).toBe('not_in_catalog')
    expect(result.missing).toEqual(['delta-unknown', 'epsilon-missing'])
    // Precedence matters: with the skill absent from the catalog, the verdict is
    // the assembly fault. Reporting `wrong_pick` here would blame the model for
    // a skill it was never offered.
    expect(result.perSkill.map((record) => record.verdict)).toEqual(['not_in_catalog', 'not_in_catalog'])
  })

  it('not_in_catalog outranks wrong_pick when both apply', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('beta-review', 'call-1', 3),
      skillResultEvent('beta-review', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['delta-unknown', 'alpha-protocol'],
    })

    expect(result.perSkill).toEqual([
      { name: 'delta-unknown', verdict: 'not_in_catalog' },
      { name: 'alpha-protocol', verdict: 'wrong_pick' },
    ])
    expect(result.verdict).toBe('not_in_catalog')
  })

  it('not_attempted: the skill was offered but the session loaded nothing at all', () => {
    const events = [headerEvent(), catalogEvent(), assistantMessageEvent('Answering directly.', 3)]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['beta-review'],
    })

    expect(evidence.calledSkills).toEqual([])
    expect(result.verdict).toBe('not_attempted')
    expect(result.missing).toEqual(['beta-review'])
  })

  it('wrong_pick: another skill was loaded and the expected one was not', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('beta-review', 'call-1', 3),
      skillResultEvent('beta-review', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })

    expect(evidence.calledSkills).toEqual(['beta-review'])
    expect(result.verdict).toBe('wrong_pick')
    expect(result.missing).toEqual(['alpha-protocol'])
  })

  it('loaded_not_effective: the load was the last tool call in the session', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      assistantMessageEvent('Loaded it.', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })

    expect(evidence.loads[0]?.usedAfterLoad).toBe(false)
    expect(result.verdict).toBe('loaded_not_effective')
  })

  it('loaded_not_effective does not fire when only another skill call follows', () => {
    // A further *skill* load proves nothing about the first one, so it is not
    // accepted as follow-through evidence.
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      skillCallEvent('beta-review', 'call-2', 5),
      skillResultEvent('beta-review', 'call-2', 6),
    ]
    const evidence = evidenceOf(events)

    expect(evidence.loads.map((load) => [load.name, load.usedAfterLoad]))
      .toEqual([['alpha-protocol', false], ['beta-review', false]])
    expect(classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    }).verdict).toBe('loaded_not_effective')
  })

  it('ok again: a later load of the same skill is judged on its own follow-through', () => {
    // The first load was the end of the session's work; the second was followed
    // by a tool call. The latest attempt is the one that counts.
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
      skillCallEvent('alpha-protocol', 'call-3', 6),
      skillResultEvent('alpha-protocol', 'call-3', 7),
      otherToolCallEvent('write_file', 'call-4', 8),
    ]
    const evidence = evidenceOf(events)

    expect(evidence.loads).toHaveLength(1)
    expect(evidence.loads[0]?.usedAfterLoad).toBe(true)
    expect(classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    }).verdict).toBe('ok')
  })

  it('unreported: no expectation list means no verdict is guessed', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: [],
    })

    expect(result.verdict).toBe('unreported')
    expect(result.perSkill).toEqual([])
    expect(result.missing).toEqual([])
  })

  it('collapses several verdicts to the worst one', () => {
    const events = [
      headerEvent(),
      catalogEvent(),
      skillCallEvent('beta-review', 'call-1', 3),
      skillResultEvent('beta-review', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ]
    const evidence = evidenceOf(events)
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['beta-review', 'alpha-protocol', 'delta-unknown'],
    })

    expect(result.perSkill).toEqual([
      { name: 'beta-review', verdict: 'ok' },
      { name: 'alpha-protocol', verdict: 'wrong_pick' },
      { name: 'delta-unknown', verdict: 'not_in_catalog' },
    ])
    expect(result.verdict).toBe('not_in_catalog')
  })
})

// ---------------------------------------------------------------------------
// Catalog extraction
// ---------------------------------------------------------------------------

describe('extractCatalog', () => {
  it('reads the entries the loader published', () => {
    const catalog = extractCatalog([headerEvent(), catalogEvent()])

    expect(catalog.present).toBe(true)
    expect(catalog.count).toBe(3)
    expect(catalog.names).toEqual(['alpha-protocol', 'beta-review', 'gamma-release'])
    expect(catalog.entries[0]?.description).toBe(DEFAULT_CATALOG[0]?.description)
  })

  it('uses the last catalog, because a replacement retires earlier names', () => {
    const replacement = [{ name: 'gamma-release', description: 'Cut a release and tag it.' }]
    const catalog = extractCatalog([headerEvent(), catalogEvent(), catalogEvent(replacement, 3, true)])

    expect(catalog.names).toEqual(['gamma-release'])
    expect(catalog.count).toBe(1)
  })

  it('treats an empty replacement as a real, present, empty catalog', () => {
    const catalog = extractCatalog([headerEvent(), catalogEvent(), catalogEvent([], 3, true)])

    expect(catalog.present).toBe(true)
    expect(catalog.count).toBe(0)
    expect(catalog.names).toEqual([])
  })

  it('reports absence when the session published no catalog at all', () => {
    const catalog = extractCatalog([headerEvent(), assistantMessageEvent('hi', 2)])

    expect(catalog.present).toBe(false)
    expect(catalog.count).toBe(0)
  })

  it('skips an unreadable catalog record and keeps the older readable one', () => {
    const broken: SessionEvent = {
      type: 'user/message',
      seq: 3,
      data: { source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: '', description: 'x' }] } },
    }

    const catalog = extractCatalog([headerEvent(), catalogEvent(), broken])

    expect(catalog.names).toEqual(['alpha-protocol', 'beta-review', 'gamma-release'])
  })

  it('ignores a skill-catalog source without an entries array', () => {
    const sourceOnly: SessionEvent = {
      type: 'user/message',
      seq: 3,
      data: { source: { kind: 'skill-catalog', form: 'catalog' } },
    }

    expect(extractCatalog([headerEvent(), catalogEvent(), sourceOnly]).count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Call and result extraction
// ---------------------------------------------------------------------------

describe('extractSkillLoads', () => {
  it('pairs a call with its result by callId', () => {
    const loads = extractSkillLoads([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3, 2, 4),
      skillResultEvent('alpha-protocol', 'call-1', 4, 2, 4),
    ])

    expect(loads).toHaveLength(1)
    expect(loads[0]).toMatchObject({ name: 'alpha-protocol', ok: true, turn: 2, step: 4, seq: 3 })
    expect(loads[0]?.reason).toBeUndefined()
  })

  it('marks a failed load and keeps the loader error text', () => {
    const error = 'Error: skill "gamma-release" is unknown or no longer available'
    const loads = extractSkillLoads([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('gamma-release', 'call-1', 3),
      skillErrorResultEvent(error, 'call-1', 4),
    ])

    expect(loads[0]).toMatchObject({ name: 'gamma-release', ok: false, reason: 'call_failed', error })
    expect(loads[0]?.usedAfterLoad).toBe(false)
  })

  it('marks a call with no result row as no_result', () => {
    const loads = extractSkillLoads([headerEvent(), catalogEvent(), skillCallEvent('alpha-protocol', 'call-1', 3)])

    expect(loads[0]).toMatchObject({ name: 'alpha-protocol', ok: false, reason: 'no_result' })
  })

  it('classifies a failed expected load as not_attempted, never ok', () => {
    const loads = extractSkillLoads([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillErrorResultEvent('Error: skill "alpha-protocol" is not available for model invocation', 'call-1', 4),
      otherToolCallEvent('read_file', 'call-2', 5),
    ])

    expect(classifySkill('alpha-protocol', {
      catalog: extractCatalog([headerEvent(), catalogEvent()]),
      loads,
      applicableSkills: ['alpha-protocol'],
    })).toBe('not_attempted')
  })

  it('ignores a skill call whose arguments are unparseable', () => {
    const broken: SessionEvent = {
      type: 'tool/call',
      seq: 3,
      data: { turn: 1, step: 1, callId: 'call-1', name: SKILL_TOOL_NAME, arguments: '{"name":' },
    }

    expect(extractSkillLoads([headerEvent(), catalogEvent(), broken])).toEqual([])
  })

  it('ignores a non-skill tool call', () => {
    const loads = extractSkillLoads([headerEvent(), catalogEvent(), otherToolCallEvent('read_file', 'call-1', 3)])

    expect(loads).toEqual([])
  })

  it('keeps only the latest attempt per skill, in first-call order', () => {
    const loads = extractSkillLoads([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('beta-review', 'call-1', 3),
      skillResultEvent('beta-review', 'call-1', 4),
      skillCallEvent('alpha-protocol', 'call-2', 5),
      skillResultEvent('alpha-protocol', 'call-2', 6),
      skillCallEvent('beta-review', 'call-3', 7),
      skillResultEvent('beta-review', 'call-3', 8),
    ])

    expect(loads.map((load) => [load.name, load.seq])).toEqual([['beta-review', 7], ['alpha-protocol', 5]])
  })
})

describe('extractToolNames', () => {
  it('lists distinct tool names and excludes the skill loader itself', () => {
    const names = extractToolNames([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      otherToolCallEvent('read_file', 'call-2', 4),
      otherToolCallEvent('read_file', 'call-3', 5),
      otherToolCallEvent('write_file', 'call-4', 6),
    ])

    expect(names).toEqual(['read_file', 'write_file'])
  })
})

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

describe('normalizeApplicableSkills', () => {
  it('trims, drops blanks and collapses duplicates keeping first-seen order', () => {
    expect(normalizeApplicableSkills([' b ', 'a', '', '  ', 'b', 'a'])).toEqual(['b', 'a'])
  })

  it('returns an empty list for empty input', () => {
    expect(normalizeApplicableSkills([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe('degradation', () => {
  it('summarizes a session with no catalog event without claiming a catalog', () => {
    const evidence = evidenceOf([headerEvent(), assistantMessageEvent('no skills here', 2)])
    const summary = summarizeCatalog(evidence)

    expect(summary).toEqual({ count: 0, names: [], present: false, called: [] })
  })

  it('reports every expected skill as not_in_catalog when no catalog was published', () => {
    const evidence = evidenceOf([headerEvent()])
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })

    expect(result.verdict).toBe('not_in_catalog')
    expect(result.perSkill).toEqual([{ name: 'alpha-protocol', verdict: 'not_in_catalog' }])
  })

  it('reports not_in_catalog when the catalog was published empty', () => {
    const evidence = evidenceOf([headerEvent(), catalogEvent([], 2)])
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })

    expect(evidence.catalog.present).toBe(true)
    expect(result.verdict).toBe('not_in_catalog')
  })

  it('still lists a load of a skill the catalog no longer offers as wrong_pick', () => {
    // The replacement retired `beta-review`; the call happened anyway.
    const evidence = evidenceOf([
      headerEvent(),
      catalogEvent(),
      catalogEvent([{ name: 'alpha-protocol', description: 'Constraint protocol.' }], 3, true),
      skillCallEvent('beta-review', 'call-1', 4),
      skillResultEvent('beta-review', 'call-1', 5),
      otherToolCallEvent('read_file', 'call-2', 6),
    ])
    const result = classifySession({
      catalog: evidence.catalog,
      loads: evidence.loads,
      applicableSkills: ['alpha-protocol'],
    })

    expect(result.verdict).toBe('wrong_pick')
    expect(summarizeCatalog(evidence).called).toEqual(['beta-review'])
  })
})

// ---------------------------------------------------------------------------
// Evidence report
// ---------------------------------------------------------------------------

describe('evidence report', () => {
  /** Render a report for one small session. */
  function report() {
    const evidence = evidenceOf([
      headerEvent(),
      catalogEvent(),
      skillCallEvent('alpha-protocol', 'call-1', 3),
      skillResultEvent('alpha-protocol', 'call-1', 4),
      assistantMessageEvent('done', 5),
    ])
    return renderEvidenceReport({
      sessionPath: '/fixture/session.v3.jsonl.zstd',
      applicableSkills: ['alpha-protocol'],
      verdict: 'loaded_not_effective',
      perSkill: [{ name: 'alpha-protocol', verdict: 'loaded_not_effective' }],
      catalog: summarizeCatalog(evidence),
      calls: evidence.loads,
      missing: ['alpha-protocol'],
      recordedAt: NOW,
    })
  }

  it('states the verdict, the expectation and the criteria', () => {
    const text = report()

    expect(text).toContain('# Skill usage audit')
    expect(text).toContain('`loaded_not_effective`')
    expect(text).toContain('alpha-protocol')
    expect(text).toContain('## Verdict criteria')
  })

  it('says so plainly when no expectation list was supplied', () => {
    const text = renderEvidenceReport({
      sessionPath: '/fixture/session.jsonl',
      applicableSkills: [],
      verdict: 'unreported',
      perSkill: [],
      catalog: { count: 0, names: [], present: false, called: [] },
      calls: [],
      missing: [],
      recordedAt: NOW,
    })

    expect(text).toContain('No expectation list was provided')
    expect(text).toContain('called the `skill` tool zero times')
  })

  it('writes atomically at 0600 and leaves no temporary file behind', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'check-skills-evidence-')), 'reports')
    created.push(dir)

    const path = writeEvidenceReport(dir, NOW, report())

    expect(path).toBe(join(dir, 'skill-usage-2026-01-02T030405678Z.md'))
    expect(readFileSync(path, 'utf8')).toBe(report())
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['skill-usage-2026-01-02T030405678Z.md'])
  })
})
