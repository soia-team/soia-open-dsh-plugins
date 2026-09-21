import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  GateConfigError,
  buildGateReport,
  gateConfigNotFoundMessage,
  normalizeChangedFiles,
  parseGateConfig,
  selectRequiredGates,
  selectUnmatchedFiles,
} from '../../src/host/gates.ts'
import { GATE_CONFIG_NOT_FOUND } from '../../src/shared/types.ts'

/** A realistic config with three gates, read the way the tool reads one. */
const VALID_CONFIG = readFileSync(new URL('../fixtures/gates.valid.yml', import.meta.url), 'utf8')

/** Build one gate document with the given block body, indented for a sequence item. */
function gateConfig(body: readonly string[]): string {
  return ['gates:', '  - id: typecheck', ...body.map((line) => `    ${line}`)].join('\n')
}

describe('gate config parsing', () => {
  it('parses the documented shape in file order', () => {
    const gates = parseGateConfig(VALID_CONFIG)

    expect(gates.map((gate) => gate.id)).toEqual(['typecheck', 'unit-tests', 'lint'])
    expect(gates[0]).toEqual({
      id: 'typecheck',
      command: 'pnpm run typecheck',
      reason: 'TypeScript sources changed.',
      rawEvidenceRequired: 'Raw exit code plus the first failing diagnostic line.',
      paths: ['packages/**/src/**', 'src/**'],
    })
  })

  it('accepts a config that declares no gate at all', () => {
    expect(parseGateConfig('gates: []\n')).toEqual([])
    expect(parseGateConfig('gates:\n')).toEqual([])
  })

  it('rejects a document that is not a gate config, with a readable reason', () => {
    expect(() => parseGateConfig('')).toThrowError(/config root: expected a mapping/)
    expect(() => parseGateConfig('other: 1\n')).toThrowError(/unknown key "other" \(allowed: gates\)/)
    expect(() => parseGateConfig('gates: 3\n')).toThrowError(/"gates" must be a list of gate mappings/)
    expect(() => parseGateConfig('gates:\n  - just a string\n')).toThrowError(/gates\[0\]: expected a mapping/)
  })

  it('rejects a gate that is missing a required field', () => {
    const withoutCommand = gateConfig([
      'reason: r',
      'rawEvidenceRequired: e',
      'when:',
      '  paths: ["src/**"]',
    ])

    expect(() => parseGateConfig(withoutCommand)).toThrowError(/gates\[0\]: missing required key "command"/)
    expect(() => parseGateConfig(gateConfig(['command: c', 'reason: r', 'rawEvidenceRequired: e'])))
      .toThrowError(/gates\[0\]: missing required key "when"/)
  })

  it('rejects mistyped fields', () => {
    expect(() => parseGateConfig(gateConfig(['command: 3', 'reason: r', 'rawEvidenceRequired: e', 'when:', '  paths: ["a"]'])))
      .toThrowError(/gates\[0\]\.command: must be a non-empty string/)
    expect(() => parseGateConfig(gateConfig(['command: c', 'reason: r', 'rawEvidenceRequired: e', 'when:', '  paths: []'])))
      .toThrowError(/gates\[0\]\.when\.paths: must be a non-empty list of glob strings/)
    expect(() => parseGateConfig(gateConfig(['command: c', 'reason: r', 'rawEvidenceRequired: e', 'when:', '  paths: "src/**"'])))
      .toThrowError(/must be a non-empty list of glob strings/)
    expect(() => parseGateConfig(gateConfig(['command: c', 'reason: r', 'rawEvidenceRequired: e', 'when:', '  paths: [""]'])))
      .toThrowError(/gates\[0\]\.when\.paths\[0\]: must be a non-empty glob string/)
  })

  it('rejects an unknown key instead of ignoring a typo', () => {
    const mistyped = gateConfig(['command: c', 'reason: r', 'rawEvidenceRequired: e', 'whenn:', '  paths: ["a"]'])

    expect(() => parseGateConfig(mistyped))
      .toThrowError(/gates\[0\]: unknown key "whenn" \(allowed: id, command, reason, rawEvidenceRequired, when\)/)
  })

  it('rejects a repeated gate id', () => {
    const duplicated = ['gates:', '  - id: a', '    command: c', '    reason: r', '    rawEvidenceRequired: e',
      '    when:', '      paths: ["src/**"]', '  - id: a', '    command: c', '    reason: r',
      '    rawEvidenceRequired: e', '    when:', '      paths: ["src/**"]'].join('\n')

    expect(() => parseGateConfig(duplicated)).toThrowError(/duplicate gate id "a" \(gates\[0\] and gates\[1\]\)/)
  })

  it('surfaces a YAML syntax failure as a config error with the line number', () => {
    let failure: unknown
    try {
      parseGateConfig('gates:\n  - id: a\n\tcommand: c\n')
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(GateConfigError)
    expect((failure as GateConfigError).line).toBe(3)
    expect((failure as Error).message).toMatch(/tab characters are not allowed in indentation \(line 3\)/)
  })
})

describe('changed-file normalization', () => {
  it('trims, folds separators, drops blanks, deduplicates and sorts', () => {
    expect(normalizeChangedFiles([' b.ts', 'a.ts', './b.ts', '', '   ', 'dir\\c.ts']))
      .toEqual(['a.ts', 'b.ts', 'dir/c.ts'])
  })

  it('returns an empty list for an empty request', () => {
    expect(normalizeChangedFiles([])).toEqual([])
  })
})

describe('gate selection', () => {
  const gates = parseGateConfig(VALID_CONFIG)

  it('selects a gate once no matter how many files match it', () => {
    const changed = normalizeChangedFiles(['src/a.ts', 'packages/x/src/b.ts', 'src/c.ts'])

    expect(selectRequiredGates(changed, gates).map((gate) => gate.id)).toEqual(['typecheck', 'lint'])
  })

  it('keeps config order and ignores the order the caller listed its files in', () => {
    const forward = selectRequiredGates(normalizeChangedFiles(['tests/x.test.ts', 'src/a.ts']), gates)
    const backward = selectRequiredGates(normalizeChangedFiles(['src/a.ts', 'tests/x.test.ts']), gates)

    expect(forward.map((gate) => gate.id)).toEqual(['typecheck', 'unit-tests', 'lint'])
    expect(forward).toEqual(backward)
  })

  it('returns only the four contract fields of a gate', () => {
    const first = selectRequiredGates(['src/a.ts'], gates)[0]

    expect(Object.keys(first ?? {})).toEqual(['id', 'command', 'reason', 'rawEvidenceRequired'])
  })

  it('reports every changed file no gate selected', () => {
    expect(selectUnmatchedFiles(normalizeChangedFiles(['README.md', 'src/a.ts']), gates)).toEqual(['README.md'])
    expect(selectUnmatchedFiles(['a', 'b'], [])).toEqual(['a', 'b'])
    expect(selectUnmatchedFiles(['src/a.ts'], gates)).toEqual([])
  })
})

describe('report assembly', () => {
  const gates = parseGateConfig(VALID_CONFIG)

  it('assembles gates and unmatched files from one changed list', () => {
    const report = buildGateReport({
      changedFiles: ['README.md', 'src/a.ts', 'src/a.ts'],
      source: '/workspace/.dsh/gates.yml',
      gates,
    })

    expect(report.changedFiles).toEqual(['README.md', 'src/a.ts'])
    expect(report.requiredGates.map((gate) => gate.id)).toEqual(['typecheck', 'lint'])
    expect(report.unmatched).toEqual(['README.md'])
    expect(report.source).toBe('/workspace/.dsh/gates.yml')
    expect(report.error).toBeNull()
  })

  it('always reports enforcement none', () => {
    expect(buildGateReport({ changedFiles: ['src/a.ts'], source: 'x', gates }).enforcement).toBe('none')
    expect(buildGateReport({ changedFiles: [], source: GATE_CONFIG_NOT_FOUND, error: 'boom' }).enforcement).toBe('none')
  })

  it('returns an empty list plus a readable reason when no config was found', () => {
    const report = buildGateReport({
      changedFiles: ['src/a.ts', 'README.md'],
      source: GATE_CONFIG_NOT_FOUND,
      error: gateConfigNotFoundMessage('/workspace'),
    })

    expect(report.source).toBe('<not found>')
    expect(report.requiredGates).toEqual([])
    expect(report.unmatched).toEqual(['README.md', 'src/a.ts'])
    expect(report.error).toBe('No gate config found: no .dsh/gates.yml in /workspace or any parent directory.')
  })

  it('treats an unusable config like an unmatched change set, never a silent drop', () => {
    const report = buildGateReport({
      changedFiles: ['src/a.ts'],
      source: '/workspace/.dsh/gates.yml',
      error: 'Invalid gate config at /workspace/.dsh/gates.yml: boom.',
    })

    expect(report.changedFiles).toEqual(['src/a.ts'])
    expect(report.requiredGates).toEqual([])
    expect(report.unmatched).toEqual(['src/a.ts'])
    expect(report.error).toMatch(/^Invalid gate config at /)
  })
})
