import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { callShapeOf } from '../../src/host/call-shape.ts'
import { evaluateCall } from '../../src/shared/evaluate.ts'
import type { PolicyRule } from '../../src/shared/types.ts'

const RULES: readonly PolicyRule[] = JSON.parse(
  readFileSync(new URL('../../danger-patterns.json', import.meta.url), 'utf8'),
) as PolicyRule[]

describe('callShapeOf', () => {
  it('reduces a bash call to its command line', () => {
    expect(callShapeOf('bash', { command: 'pnpm vitest run packages/x' }))
      .toEqual({ tool: 'bash', text: 'pnpm vitest run packages/x' })
  })

  it('reduces write and edit to the tool name plus the target path', () => {
    expect(callShapeOf('write', { file_path: 'src/index.ts', content: 'x' }))
      .toEqual({ tool: 'write', text: 'write src/index.ts' })
    expect(callShapeOf('edit', { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' }))
      .toEqual({ tool: 'edit', text: 'edit src/index.ts' })
  })

  it('never matches file content, only the target path', () => {
    const shape = callShapeOf('write', { file_path: 'docs/notes.md', content: 'rm -rf ~/.myapp' })

    expect(shape.text).not.toContain('~/.myapp')
    expect(evaluateCall(shape, RULES).action).toBe('allow')
  })

  it('produces an empty text for tools it does not understand', () => {
    expect(callShapeOf('read', { file_path: 'src/index.ts' })).toEqual({ tool: 'read', text: '' })
    expect(evaluateCall(callShapeOf('read', { file_path: '~/.myapp/x' }), RULES).action).toBe('allow')
  })

  it('is total: odd arguments reduce to an empty text instead of throwing', () => {
    expect(callShapeOf('bash', undefined).text).toBe('')
    expect(callShapeOf('bash', null).text).toBe('')
    expect(callShapeOf('bash', 'ls -la').text).toBe('')
    expect(callShapeOf('bash', { command: 42 }).text).toBe('')
    expect(callShapeOf('write', {}).text).toBe('')
  })

  it('feeds the matcher the text the shipped rules expect', () => {
    const denied = evaluateCall(callShapeOf('write', { file_path: '~/.myapp/settings.json' }), RULES)
    const asked = evaluateCall(callShapeOf('bash', { command: 'git stash push -m wip' }), RULES)

    expect(denied.ruleId).toBe('data-root-write')
    expect(asked.ruleId).toBe('git-danger')
  })
})
