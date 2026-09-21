import { describe, expect, it } from 'vitest'

import { YamlError, parseYamlSubset } from '../../src/host/yaml.ts'

/** The supported subset, and the refusals that keep it from guessing. */
describe('yaml subset', () => {
  it('parses block mappings, block sequences and nested blocks', () => {
    const document = parseYamlSubset([
      'gates:',
      '  - id: typecheck',
      '    command: pnpm run typecheck',
      '    when:',
      '      paths: ["src/**"]',
      '  - id: lint',
      '    command: pnpm run lint',
      '    when:',
      '      paths:',
      '        - "**/*.ts"',
    ].join('\n'))

    expect(document).toEqual({
      gates: [
        { id: 'typecheck', command: 'pnpm run typecheck', when: { paths: ['src/**'] } },
        { id: 'lint', command: 'pnpm run lint', when: { paths: ['**/*.ts'] } },
      ],
    })
  })

  it('strips comments, blank lines, a trailing comment and one leading ---', () => {
    const document = parseYamlSubset([
      '---',
      '# a full-line comment',
      '',
      'id: typecheck   # a trailing comment',
      'note: "# not a comment"',
    ].join('\n'))

    expect(document).toEqual({ id: 'typecheck', note: '# not a comment' })
  })

  it('reads single-quoted, double-quoted and plain scalars', () => {
    const document = parseYamlSubset([
      "single: 'it''s raw'",
      'double: "line\\nbreak"',
      'plain: pnpm run typecheck',
      'count: 3',
      'flag: true',
      'nothing: ~',
      'empty:',
    ].join('\n'))

    expect(document).toEqual({
      single: "it's raw",
      double: 'line\nbreak',
      plain: 'pnpm run typecheck',
      count: 3,
      flag: true,
      nothing: null,
      empty: null,
    })
  })

  it('returns null for an empty document', () => {
    expect(parseYamlSubset('')).toBeNull()
    expect(parseYamlSubset('# only a comment\n\n')).toBeNull()
  })

  it('rejects tab indentation with the line number', () => {
    expect(() => parseYamlSubset('gates:\n\t- id: a\n')).toThrowError(/tab characters.*line 2/)
  })

  it('rejects an unterminated quote with the line number', () => {
    expect(() => parseYamlSubset('id: "unterminated\n')).toThrowError(YamlError)
    expect(() => parseYamlSubset('id: "unterminated\n')).toThrowError(/unterminated double-quoted string.*line 1/)
  })

  it('rejects an unknown escape sequence', () => {
    expect(() => parseYamlSubset('id: "a\\qb"\n')).toThrowError(/unsupported escape sequence.*line 1/)
  })

  it('rejects a duplicate key', () => {
    expect(() => parseYamlSubset('id: a\nid: b\n')).toThrowError(/duplicate key "id".*line 2/)
  })

  it('rejects a line that is not a key-value pair', () => {
    expect(() => parseYamlSubset('gates:\n  typecheck\n')).toThrowError(/expected a "key: value" pair.*line 2/)
  })

  it('rejects features outside the subset instead of guessing', () => {
    expect(() => parseYamlSubset('when: {paths: [a]}\n')).toThrowError(/flow mappings are not supported/)
    expect(() => parseYamlSubset('reason: |\n  text\n')).toThrowError(/block scalars are not supported/)
    expect(() => parseYamlSubset('id: @value\n')).toThrowError(/unsupported scalar syntax/)
    expect(() => parseYamlSubset('base: &anchor\n')).toThrowError(/anchors and aliases are not supported/)
    expect(() => parseYamlSubset('copy: *anchor\n')).toThrowError(/anchors and aliases are not supported/)
    expect(() => parseYamlSubset('id: !tag x\n')).toThrowError(/tags are not supported/)
    expect(() => parseYamlSubset('paths: [a, {b: c}]\n')).toThrowError(/nested flow collections are not supported/)
  })

  it('rejects an unterminated or malformed flow sequence', () => {
    expect(() => parseYamlSubset('paths: [a, b\n')).toThrowError(/unterminated flow sequence/)
    expect(() => parseYamlSubset('paths: [a, , b]\n')).toThrowError(/empty item in a flow sequence/)
    expect(() => parseYamlSubset('paths: [a]]\n')).toThrowError(/unexpected "\]" inside a flow sequence/)
  })

  it('rejects a line indented deeper than the block it belongs to', () => {
    expect(() => parseYamlSubset('gates:\n  - id: a\n     command: b\n')).toThrowError(/unexpected indentation.*line 3/)
  })

  it('rejects trailing content after the document root', () => {
    expect(() => parseYamlSubset('- first\nid: a\n')).toThrowError(/unexpected content after the document root.*line 2/)
  })
})
