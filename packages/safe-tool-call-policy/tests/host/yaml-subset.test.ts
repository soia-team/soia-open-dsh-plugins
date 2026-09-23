import { describe, expect, it } from 'vitest'

import { PolicyConfigError } from '../../src/host/config-error.ts'
import { parseYamlSubset } from '../../src/host/yaml-subset.ts'

/** The document shape the policy actually uses, with a comment and a flow list. */
const DOCUMENT = `# project policy
disable:
  - failure-as-evidence
  - other-rule
rules:
  - id: no-prod-db
    tool: bash
    pattern: "psql .*prod"      # quoted because of the space and the star
    action: ask
    reason: 'Touches production.'
    remedy: "Use the staging DSN."
    source: project
`

describe('parseYamlSubset', () => {
  it('reads the policy document shape', () => {
    expect(parseYamlSubset(DOCUMENT)).toEqual({
      disable: ['failure-as-evidence', 'other-rule'],
      rules: [
        {
          id: 'no-prod-db',
          tool: 'bash',
          pattern: 'psql .*prod',
          action: 'ask',
          reason: 'Touches production.',
          remedy: 'Use the staging DSN.',
          source: 'project',
        },
      ],
    })
  })

  it('reads an empty document as an empty mapping', () => {
    expect(parseYamlSubset('')).toEqual({})
    expect(parseYamlSubset('\n# only a comment\n\n')).toEqual({})
  })

  it('unescapes doubled single quotes, as YAML does', () => {
    expect(parseYamlSubset("reason: 'it''s fine'")).toEqual({ reason: "it's fine" })
  })

  it('reads a flow sequence as JSON or as a bare comma list', () => {
    expect(parseYamlSubset('disable: ["a", "b"]')).toEqual({ disable: ['a', 'b'] })
    expect(parseYamlSubset('disable: [a, b]')).toEqual({ disable: ['a', 'b'] })
    expect(parseYamlSubset('disable: []')).toEqual({ disable: [] })
  })

  it('keeps a hash that is not preceded by whitespace', () => {
    expect(parseYamlSubset('pattern: foo#bar')).toEqual({ pattern: 'foo#bar' })
  })

  it('rejects tab indentation', () => {
    expect(() => parseYamlSubset('rules:\n\t- id: x')).toThrow(PolicyConfigError)
  })

  it('rejects a top-level line that is not a key', () => {
    expect(() => parseYamlSubset('just a line')).toThrow(/expected "key: value" at the top level/)
  })

  it('rejects a nested mapping below the supported item level', () => {
    expect(() => parseYamlSubset('rules:\n  - id: x\n    deeper:\n      nested: y')).toThrow(PolicyConfigError)
  })

  it('rejects a block scalar', () => {
    expect(() => parseYamlSubset('reason: |\n  multi line')).toThrow(/block scalars are not supported/)
  })

  it('rejects anchors, aliases, and unquoted values with a colon', () => {
    expect(() => parseYamlSubset('pattern: *alias')).toThrow(/quote the value/)
    expect(() => parseYamlSubset('reason: see: below')).toThrow(/quote the value/)
  })

  it('rejects duplicate keys and unterminated quotes', () => {
    expect(() => parseYamlSubset('rules: [a]\nrules: [b]')).toThrow(/duplicate key/)
    expect(() => parseYamlSubset('pattern: "unterminated')).toThrow(/unterminated flow sequence|invalid double-quoted/)
  })

  it('rejects a sequence item indented differently from its siblings', () => {
    expect(() => parseYamlSubset('disable:\n  - a\n   - b')).toThrow(/indented differently/)
  })

  it('rejects a key with no value and no sequence', () => {
    expect(() => parseYamlSubset('rules:')).toThrow(/no value and no block sequence/)
  })
})
