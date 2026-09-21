import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluateCall } from '../../src/shared/evaluate.ts'
import type { PolicyRule } from '../../src/shared/types.ts'

/**
 * The test set IS the shipped `danger-patterns.json` — the same bytes the host
 * loads — so a rule that stops matching, or a pattern that stops compiling, is
 * a red test rather than a silent loss of protection.
 */
const RULES: readonly PolicyRule[] = JSON.parse(
  readFileSync(new URL('../../danger-patterns.json', import.meta.url), 'utf8'),
) as PolicyRule[]

/** The contract each shipped rule must keep: id, tool selector, action, provenance. */
const CONTRACT: readonly { readonly id: string, readonly tool: string, readonly action: string, readonly source: string }[] = [
  { id: 'data-root-write', tool: '*', action: 'deny', source: 'memory:executor-real-home-writes' },
  { id: 'secret-in-argv', tool: 'bash', action: 'deny', source: 'memory:secret-in-argv' },
  { id: 'failure-as-evidence', tool: 'bash', action: 'ask', source: 'memory:failed-command-not-evidence' },
  { id: 'git-danger', tool: 'bash', action: 'ask', source: 'memory:concurrent-git-index' },
  { id: 'high-impact-action', tool: 'bash', action: 'ask', source: 'codex-memory:failures' },
  { id: 'destructive-cleanup', tool: 'bash', action: 'ask', source: 'memory:worktree-cleanup-rule' },
]

/**
 * One positive and one negative case per rule. `hit` MUST produce exactly that
 * rule as the deciding rule; `allow` MUST match no rule at all. These are plain
 * strings — no test here ever executes a command.
 */
const CASES: readonly { readonly id: string, readonly tool: string, readonly hit: string, readonly allow: string }[] = [
  {
    id: 'data-root-write',
    tool: 'bash',
    hit: 'rm -rf ~/.config/app/cache',
    allow: 'cat ~/.config/app/settings.json',
  },
  {
    id: 'data-root-write',
    tool: 'write',
    hit: 'write ~/.myapp/settings.json',
    allow: 'write src/index.ts',
  },
  {
    id: 'secret-in-argv',
    tool: 'bash',
    hit: 'mysql -h db -u root -pS3cretPass9 -e "select 1"',
    allow: 'git log --oneline -20',
  },
  {
    id: 'failure-as-evidence',
    tool: 'bash',
    hit: 'grep -rn TODO --include=*.ts src/',
    allow: "grep -rn 'TODO' --include='*.ts' src/ | head -20",
  },
  {
    id: 'git-danger',
    tool: 'bash',
    hit: 'git commit -m "wip"',
    allow: 'git commit --only src/index.ts -m "msg"',
  },
  {
    id: 'high-impact-action',
    tool: 'bash',
    hit: 'npm publish --access public',
    allow: 'pnpm run build',
  },
  {
    id: 'destructive-cleanup',
    tool: 'bash',
    hit: 'rm -rf .worktrees/feature-login',
    allow: 'rm -rf node_modules',
  },
]

describe('shipped rule set', () => {
  it('ships exactly the contracted rules, with their action and provenance', () => {
    expect(RULES.map((rule) => rule.id)).toEqual(CONTRACT.map((entry) => entry.id))

    for (const entry of CONTRACT) {
      const rule = RULES.find((candidate) => candidate.id === entry.id)

      expect(rule?.tool, entry.id).toBe(entry.tool)
      expect(rule?.action, entry.id).toBe(entry.action)
      expect(rule?.source, entry.id).toBe(entry.source)
      expect(rule?.reason.length ?? 0, entry.id).toBeGreaterThan(0)
      expect(rule?.remedy.length ?? 0, entry.id).toBeGreaterThan(0)
    }
  })

  it('compiles every shipped pattern', () => {
    for (const rule of RULES) expect(() => new RegExp(rule.pattern), rule.id).not.toThrow()
  })

  it('keeps every rule traceable to a recorded source namespace', () => {
    for (const rule of RULES) {
      expect(rule.source, rule.id).toMatch(/^(?:memory|codex-memory):[\w-]+$/)
    }
  })

  it('hard-codes no machine path: home roots are matched as ~ or $HOME only', () => {
    for (const rule of RULES) {
      expect(JSON.stringify(rule), rule.id).not.toMatch(/\/(?:Users|home)\//)
    }
  })
})

describe('one positive and one negative case per rule', () => {
  for (const testCase of CASES) {
    describe(`${testCase.id} (${testCase.tool})`, () => {
      it(`stops the dangerous variant`, () => {
        const decision = evaluateCall({ tool: testCase.tool, text: testCase.hit }, RULES)

        expect(decision.ruleId).toBe(testCase.id)
        expect(decision.matched).toContain(testCase.id)
        expect(decision.reason?.length ?? 0).toBeGreaterThan(0)
        expect(decision.remedy?.length ?? 0).toBeGreaterThan(0)
      })

      it(`lets the safe variant through`, () => {
        const decision = evaluateCall({ tool: testCase.tool, text: testCase.allow }, RULES)

        expect(decision.action).toBe('allow')
        expect(decision.matched).toEqual([])
        expect(decision.ruleId).toBeUndefined()
      })
    })
  }

  it('covers every shipped rule with at least one case', () => {
    expect(new Set(CASES.map((testCase) => testCase.id))).toEqual(new Set(RULES.map((rule) => rule.id)))
  })
})

describe('verdict precedence', () => {
  it('prefers deny over ask when one call matches both', () => {
    const decision = evaluateCall({ tool: 'bash', text: 'rm -rf ~/.config/app/cache' }, RULES)

    expect(decision.matched).toContain('data-root-write')
    expect(decision.matched).toContain('high-impact-action')
    expect(decision.action).toBe('deny')
    expect(decision.ruleId).toBe('data-root-write')
  })

  it('breaks an equal verdict by rule order', () => {
    const decision = evaluateCall({ tool: 'bash', text: 'git worktree remove --force .worktrees/x' }, RULES)

    expect(decision.matched).toEqual(['high-impact-action', 'destructive-cleanup'])
    expect(decision.action).toBe('ask')
    expect(decision.ruleId).toBe('high-impact-action')
  })

  it('allows an empty text, which is what an unsupported tool reduces to', () => {
    const decision = evaluateCall({ tool: 'read', text: '' }, RULES)

    expect(decision.action).toBe('allow')
    expect(decision.matched).toEqual([])
  })

  it('applies a bash-only rule to bash only', () => {
    const decision = evaluateCall({ tool: 'edit', text: 'edit npm publish notes.md' }, RULES)

    expect(decision.action).toBe('allow')
  })

  it('applies a wildcard rule to write and edit as well', () => {
    const written = evaluateCall({ tool: 'write', text: 'write ~/.myapp/state.json' }, RULES)
    const edited = evaluateCall({ tool: 'edit', text: 'edit /etc/myapp.conf' }, RULES)

    expect(written.ruleId).toBe('data-root-write')
    expect(edited.ruleId).toBe('data-root-write')
  })
})

describe('policy defects', () => {
  /** A project rule whose pattern cannot compile, ahead of one that can. */
  const DEFECTIVE: readonly PolicyRule[] = [
    {
      id: 'broken-pattern',
      tool: 'bash',
      pattern: 'rm -rf (',
      action: 'deny',
      reason: 'unreachable',
      remedy: 'unreachable',
      source: 'test',
    },
    ...RULES,
  ]

  it('skips an uncompilable pattern with a note and still applies the rest', () => {
    const decision = evaluateCall({ tool: 'bash', text: 'npm publish' }, DEFECTIVE)

    expect(decision.ruleId).toBe('high-impact-action')
    expect(decision.notes.join('\n')).toContain('broken-pattern')
  })

  it('reports the skipped rule even when nothing else matches', () => {
    const decision = evaluateCall({ tool: 'bash', text: 'pnpm run build' }, DEFECTIVE)

    expect(decision.action).toBe('allow')
    expect(decision.notes).toHaveLength(1)
  })
})
