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
    // The live acceptance run caught this exact command being asked: the rule's
    // first branch matched `git stash` without looking at the subcommand, so a
    // read-only `git stash list` inside an inspection command tripped it.
    allow: 'git rev-parse --show-toplevel 2>&1; echo "--- branch ---"; git branch --show-current; '
      + 'git status --short; git diff --cached --name-status; git stash list',
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

  it('hard-codes no machine-specific path', () => {
    // The constraint is portability, not the absence of `/Users`: a rule cannot
    // know whose machine it runs on, so a home root has to be matched by shape
    // (`~`, `$HOME`, `/Users/<anyone>/.<app>`) rather than by a literal path.
    // Measured: a model wrote the expanded form and the earlier rule let a
    // deletion of an app data root through, so matching only `~`/`$HOME` was a
    // false negative rather than a virtue.
    for (const rule of RULES) {
      const text = JSON.stringify(rule)
      expect(text, rule.id).not.toMatch(/\/(?:Users|home)\/[A-Za-z0-9._-]+\/\.?[A-Za-z0-9._-]+\b(?![\w.*+?^${}()|[\]\\-])/)
      expect(text, rule.id).not.toMatch(/\/Users\/zp\b|\/home\/zp\b/)
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
    // Two rules of equal severity over the same text: the first one wins, which
    // is what makes the shipped order meaningful.
    const pair: readonly PolicyRule[] = [
      { id: 'first', tool: 'bash', pattern: 'shared-token', action: 'ask', reason: 'r', remedy: 'y', source: 'test' },
      { id: 'second', tool: 'bash', pattern: 'shared-token', action: 'ask', reason: 'r', remedy: 'y', source: 'test' },
    ]
    const decision = evaluateCall({ tool: 'bash', text: 'echo shared-token' }, pair)

    expect(decision.matched).toEqual(['first', 'second'])
    expect(decision.ruleId).toBe('first')
  })

  it('lets the worktree rule own worktree removal instead of the broad-impact rule', () => {
    const decision = evaluateCall({ tool: 'bash', text: 'git worktree remove --force .worktrees/x' }, RULES)

    expect(decision.matched).toEqual(['destructive-cleanup'])
    expect(decision.action).toBe('ask')
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

  it('flags a silenced search but not an everyday stderr redirect', () => {
    // Second false positive found by the live acceptance run: a listener probe
    // with a `||` fallback was asked because `2>/dev/null` appeared before a
    // pipe character. `||` is an explicit fallback, not a discarded error.
    const probe = 'echo "--- is 8899 listening?"; (lsof -nP -iTCP:8899 -sTCP:LISTEN 2>/dev/null '
      + '|| echo "(no lsof result)"); curl -s http://127.0.0.1:8899/x | head -1'
    expect(evaluateCall({ tool: 'bash', text: probe }, RULES).ruleId).toBeUndefined()

    // The documented failure mode is still caught: a search whose errors were
    // thrown away, piped into something that would read "nothing" as "not found".
    expect(evaluateCall({ tool: 'bash', text: 'grep -rn TODO src 2>/dev/null | head -20' }, RULES).ruleId)
      .toBe('failure-as-evidence')
  })

  it('separates reading the stash from writing it', () => {
    const rules = RULES
    expect(evaluateCall({ tool: 'bash', text: 'git stash list' }, rules).ruleId).toBeUndefined()
    expect(evaluateCall({ tool: 'bash', text: 'git stash show -p stash@{0}' }, rules).ruleId).toBeUndefined()
    expect(evaluateCall({ tool: 'bash', text: 'git stash push -m wip' }, rules).ruleId).toBe('git-danger')
    expect(evaluateCall({ tool: 'bash', text: 'git stash' }, rules).ruleId).toBe('git-danger')
    expect(evaluateCall({ tool: 'bash', text: 'git stash pop' }, rules).ruleId).toBe('git-danger')
  })
})
