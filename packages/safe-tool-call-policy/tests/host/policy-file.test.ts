import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { findPolicyFile, loadPolicy } from '../../src/host/policy-file.ts'
import { evaluateCall } from '../../src/shared/evaluate.ts'

/** The shipped pattern set, addressed exactly as `src/index.ts` addresses it. */
const BUILTIN = new URL('../../danger-patterns.json', import.meta.url)

/** A project root with no `.dsh/` at all. */
const PLAIN_PROJECT = mkdtempSync(join(tmpdir(), 'safe-tool-call-policy-plain-'))

/** One fixture project directory under `tests/fixtures/`. */
function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url))
}

afterAll(() => {
  rmSync(PLAIN_PROJECT, { recursive: true, force: true })
})

describe('findPolicyFile', () => {
  it('finds nothing in a project without .dsh', () => {
    expect(findPolicyFile(PLAIN_PROJECT)).toBeUndefined()
  })

  it('prefers policy.yml over policy.json when both exist', () => {
    expect(findPolicyFile(fixture('project-both'))?.path.endsWith('.dsh/policy.yml')).toBe(true)
  })

  it('falls back to policy.json', () => {
    expect(findPolicyFile(fixture('project-json'))?.format).toBe('json')
  })

  it('does not throw on a project root that cannot be read', () => {
    expect(findPolicyFile('\u0000unreadable')).toBeUndefined()
  })
})

describe('loadPolicy', () => {
  it('uses the shipped list when the project has no policy file', () => {
    const policy = loadPolicy({ projectRoot: PLAIN_PROJECT, builtinUrl: BUILTIN })

    expect(policy.notes).toEqual([])
    expect(policy.sourcePath).toBeUndefined()
    expect(policy.rules.map((rule) => rule.id)).toContain('data-root-write')

    const decision = evaluateCall({ tool: 'bash', text: 'npm publish' }, policy.rules)

    expect(decision.action).toBe('ask')
  })

  it('appends, overrides, and disables through a YAML project file', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-yaml'), builtinUrl: BUILTIN })
    const ids = policy.rules.map((rule) => rule.id)

    expect(policy.sourcePath?.endsWith('.dsh/policy.yml')).toBe(true)
    expect(ids).toContain('no-prod-db')
    expect(ids).not.toContain('failure-as-evidence')
    expect(ids.filter((id) => id === 'high-impact-action')).toHaveLength(1)

    expect(evaluateCall({ tool: 'bash', text: 'psql -h prod -c "select 1"' }, policy.rules).ruleId)
      .toBe('no-prod-db')
    expect(evaluateCall({ tool: 'bash', text: 'npm publish' }, policy.rules).ruleId)
      .toBe('high-impact-action')
    expect(evaluateCall({ tool: 'bash', text: 'git stash push' }, policy.rules).ruleId).toBe('git-danger')
  })

  it('disables built-in rules through a JSON project file', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-json'), builtinUrl: BUILTIN })

    expect(evaluateCall({ tool: 'bash', text: 'npm publish' }, policy.rules).action).toBe('allow')
    expect(evaluateCall({ tool: 'bash', text: 'cli --token=abcd1234efgh' }, policy.rules).action).toBe('allow')
    expect(evaluateCall({ tool: 'bash', text: 'git stash push' }, policy.rules).action).toBe('ask')
  })

  it('fails open with a note when the project file cannot be parsed', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-broken-json'), builtinUrl: BUILTIN })

    expect(policy.rules).toEqual([])
    expect(policy.notes.join('\n')).toContain('fail-open')
    expect(evaluateCall({ tool: 'bash', text: 'rm -rf ~/.myapp' }, policy.rules).action).toBe('allow')
  })

  it('fails open with a note when the YAML is outside the supported subset', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-broken-yaml'), builtinUrl: BUILTIN })

    expect(policy.rules).toEqual([])
    expect(policy.notes.join('\n')).toContain('unusable')
  })

  it('fails open with a note when the project file cannot be read', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-unreadable'), builtinUrl: BUILTIN })

    expect(policy.rules).toEqual([])
    expect(policy.notes.join('\n')).toContain('unreadable')
  })

  it('reads only the YAML file when both exist', () => {
    const policy = loadPolicy({ projectRoot: fixture('project-both'), builtinUrl: BUILTIN })
    const decision = evaluateCall({ tool: 'bash', text: 'make deploy' }, policy.rules)

    expect(decision.ruleId).toBe('from-yaml')
    expect(decision.action).toBe('ask')
  })

  it('fails open with a note when the shipped pattern set itself is missing', () => {
    const policy = loadPolicy({
      projectRoot: PLAIN_PROJECT,
      builtinUrl: new URL('../../missing-danger-patterns.json', import.meta.url),
    })

    expect(policy.rules).toEqual([])
    expect(policy.notes.join('\n')).toContain('unreadable')
  })
})
