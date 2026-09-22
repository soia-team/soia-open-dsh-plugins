import { describe, expect, it } from 'vitest'

import { renderPolicyReason } from '../../src/shared/reason.ts'

/**
 * The interception message is the only text this package puts in front of a
 * model, and it must name its source.
 *
 * An operator reported intercepting calls that produced nothing but
 * "[tool rejected]" — no reason, no rule, no plugin — and could not tell a policy
 * decision from a temporary fault. The closing clause below is that requirement
 * expressed as a test: 插件名称：具体报错原因.
 */
describe('interception message', () => {
  it('ends with the plugin name and the concrete reason', () => {
    const text = renderPolicyReason({
      action: 'deny',
      matched: ['data-root-write'],
      notes: [],
      ruleId: 'data-root-write',
      reason: 'This command writes inside ~/.myapp.',
      remedy: 'Write under the session workspace instead.',
    })

    expect(text.endsWith('插件 soia-dsh-safe-tool-call-policy：This command writes inside ~/.myapp.')).toBe(true)
  })

  it('names the rule, so the reader can look it up', () => {
    const text = renderPolicyReason({
      action: 'ask',
      matched: ['git-danger'],
      notes: [],
      ruleId: 'git-danger',
      reason: 'This git command takes the whole shared index.',
    })

    expect(text).toContain('(rule: git-danger)')
    expect(text).toContain('soia-dsh-safe-tool-call-policy')
  })

  it('stays a single line and never empty', () => {
    const text = renderPolicyReason({ action: 'deny', matched: [], notes: [] })

    expect(text).not.toContain('\n')
    expect(text).toContain('soia-dsh-safe-tool-call-policy')
  })
})
