import { describe, expect, it } from 'vitest'

import { PolicyConfigError } from '../../src/host/config-error.ts'
import { mergePolicyRules, parsePolicyDocument } from '../../src/host/policy-document.ts'
import type { PolicyRule } from '../../src/shared/types.ts'

/** Two built-in rules stand in for the shipped set: one deny, one ask. */
const BUILTIN: readonly PolicyRule[] = [
  {
    id: 'data-root-write',
    tool: '*',
    pattern: '~/\\.[\\w.-]+',
    action: 'deny',
    reason: 'Writes into an application-data root.',
    remedy: 'Write under the workspace instead.',
    source: 'memory:executor-real-home-writes',
  },
  {
    id: 'git-danger',
    tool: 'bash',
    pattern: '\\bgit\\s+stash\\b',
    action: 'ask',
    reason: 'Mutates shared checkout state.',
    remedy: 'Use explicit pathspecs.',
    source: 'memory:concurrent-git-index',
  },
]

/** The default document: present, empty, and therefore the built-in list. */
const EMPTY = parsePolicyDocument('{}', 'json', 'empty')

describe('parsePolicyDocument', () => {
  it('reads a YAML document with rules and disable', () => {
    const document = parsePolicyDocument(
      'rules:\n  - id: mine\n    pattern: "x"\n    action: ask\n    reason: r\n    remedy: y\ndisable:\n  - git-danger\n',
      'yaml',
      'policy.yml',
    )

    expect(document.notes).toEqual([])
    expect(document.disable).toEqual(['git-danger'])
    expect(document.rules).toHaveLength(1)
    expect(document.rules[0]).toMatchObject({ id: 'mine', tool: '*', pattern: 'x', action: 'ask' })
  })

  it('reads the same document as JSON', () => {
    const document = parsePolicyDocument(
      '{"rules":[{"id":"mine","tool":"bash","pattern":"x","action":"deny","reason":"r","remedy":"y","source":"s"}]}',
      'json',
      'policy.json',
    )

    expect(document.rules[0]).toMatchObject({ id: 'mine', tool: 'bash', action: 'deny', source: 's' })
  })

  it('treats an empty document as "no project layer"', () => {
    expect(EMPTY).toEqual({ rules: [], disable: [], notes: [] })
    expect(parsePolicyDocument('', 'yaml', 'policy.yml')).toEqual({ rules: [], disable: [], notes: [] })
  })

  it('fails the whole document when it cannot be parsed', () => {
    expect(() => parsePolicyDocument('{ not json', 'json', 'policy.json')).toThrow(PolicyConfigError)
    expect(() => parsePolicyDocument('rules:\n\t- id: x', 'yaml', 'policy.yml')).toThrow(PolicyConfigError)
  })

  it('fails the whole document when its top-level shape is unusable', () => {
    expect(() => parsePolicyDocument('[]', 'json', 'policy.json')).toThrow(/must be a mapping/)
    expect(() => parsePolicyDocument('{"rules":"nope"}', 'json', 'policy.json')).toThrow(/"rules" must be a list/)
    expect(() => parsePolicyDocument('{"disable":"nope"}', 'json', 'policy.json')).toThrow(/"disable" must be a list/)
  })

  it('notes an unknown top-level key instead of guessing', () => {
    const document = parsePolicyDocument('{"rulez":[]}', 'json', 'policy.json')

    expect(document.rules).toEqual([])
    expect(document.notes.join('\n')).toContain('unknown top-level key "rulez"')
  })

  it('drops an unusable entry with a note and keeps the usable ones', () => {
    const document = parsePolicyDocument(
      JSON.stringify({
        rules: [
          { id: 'good', pattern: 'x', action: 'ask', reason: 'r', remedy: 'y' },
          { id: 'no-pattern', action: 'ask', reason: 'r', remedy: 'y' },
          { id: 'bad-action', pattern: 'x', action: 'maybe', reason: 'r', remedy: 'y' },
          { id: 'bad-regex', pattern: 'rm (', action: 'ask', reason: 'r', remedy: 'y' },
          { id: 'bad-tool', tool: 'pwsh', pattern: 'x', action: 'ask', reason: 'r', remedy: 'y' },
          { id: 'No-Kebab', pattern: 'x', action: 'ask', reason: 'r', remedy: 'y' },
          'not-a-mapping',
        ],
      }),
      'json',
      'policy.json',
    )

    expect(document.rules.map((rule) => rule.id)).toEqual(['good'])
    expect(document.notes).toHaveLength(6)
    expect(document.notes.join('\n')).toContain('bad-regex')
  })

  it('keeps a rule that carries an extra field and says so', () => {
    const document = parsePolicyDocument(
      '{"rules":[{"id":"mine","pattern":"x","action":"ask","reason":"r","remedy":"y","extra":1}]}',
      'json',
      'policy.json',
    )

    expect(document.rules.map((rule) => rule.id)).toEqual(['mine'])
    expect(document.notes.join('\n')).toContain('unknown field "extra"')
  })

  it('reads an allow entry as a retirement of that id, needing no wording', () => {
    const document = parsePolicyDocument('{"rules":[{"id":"git-danger","action":"allow"}]}', 'json', 'policy.json')

    expect(document.rules[0]).toMatchObject({ id: 'git-danger', action: 'allow' })
    expect(mergePolicyRules(BUILTIN, document).rules.map((rule) => rule.id)).toEqual(['data-root-write'])
  })

  it('skips a disable entry that is not a rule id', () => {
    const document = parsePolicyDocument('{"disable":["ok-id",7,"Bad Id"]}', 'json', 'policy.json')

    expect(document.disable).toEqual(['ok-id'])
    expect(document.notes).toHaveLength(2)
  })
})

describe('mergePolicyRules', () => {
  it('keeps the built-in rules when the document is empty', () => {
    expect(mergePolicyRules(BUILTIN, EMPTY).rules).toEqual(BUILTIN)
  })

  it('appends a rule with a new id', () => {
    const document = parsePolicyDocument(
      '{"rules":[{"id":"no-prod-db","pattern":"prod","action":"deny","reason":"r","remedy":"y"}]}',
      'json',
      'policy.json',
    )

    const merged = mergePolicyRules(BUILTIN, document)

    expect(merged.rules.map((rule) => rule.id)).toEqual(['data-root-write', 'git-danger', 'no-prod-db'])
    expect(merged.rules[2]?.source).toBe('project policy override')
  })

  it('replaces a built-in rule in place, so a project can loosen a deny to ask', () => {
    const document = parsePolicyDocument(
      '{"rules":[{"id":"data-root-write","tool":"*","pattern":"~/\\\\.x","action":"ask","reason":"project wording","remedy":"project remedy"}]}',
      'json',
      'policy.json',
    )

    const merged = mergePolicyRules(BUILTIN, document)

    expect(merged.rules.map((rule) => rule.id)).toEqual(['data-root-write', 'git-danger'])
    expect(merged.rules[0]?.action).toBe('ask')
    expect(merged.rules[0]?.reason).toBe('project wording')
  })

  it('disables by id, and disabling wins over an entry that just added it', () => {
    const document = parsePolicyDocument(
      '{"rules":[{"id":"no-prod-db","pattern":"prod","action":"deny","reason":"r","remedy":"y"}],"disable":["git-danger","no-prod-db"]}',
      'json',
      'policy.json',
    )

    const merged = mergePolicyRules(BUILTIN, document)

    expect(merged.rules.map((rule) => rule.id)).toEqual(['data-root-write'])
  })

  it('notes a disable entry that names nothing', () => {
    const document = parsePolicyDocument('{"disable":["no-such-rule"]}', 'json', 'policy.json')

    const merged = mergePolicyRules(BUILTIN, document)

    expect(merged.rules).toEqual(BUILTIN)
    expect(merged.notes.join('\n')).toContain('no-such-rule')
  })
})
