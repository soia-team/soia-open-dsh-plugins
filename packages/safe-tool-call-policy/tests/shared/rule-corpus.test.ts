import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { evaluateCall } from '../../src/shared/evaluate.ts'
import type { PolicyRule } from '../../src/shared/types.ts'

/**
 * A command corpus for the six shipped rules.
 *
 * Two false positives reached production before this file existed — a read-only
 * `git stash list` asked as a shared-checkout mutation, and an `lsof … ||
 * echo …` probe asked as discarded evidence — and both came from rules that
 * matched on substrings instead of on what the command does. Unit tests written
 * from the same mental model as the pattern cannot find that class of bug; a
 * corpus of ordinary commands can.
 *
 * Every entry states the decision the rule set must reach, so this is a
 * two-sided contract: `hit` proves the protection still exists, `quiet` proves
 * the rule does not fire on work that is obviously safe. Each `quiet` case is a
 * command a real session plausibly runs.
 */
const RULES: readonly PolicyRule[] = JSON.parse(
  readFileSync(new URL('../../danger-patterns.json', import.meta.url), 'utf8'),
) as PolicyRule[]

interface Case {
  /** Rule expected to decide, or undefined when nothing may fire. */
  readonly rule: string | undefined
  /** The command, or the file-effect description for write-shaped tools. */
  readonly text: string
  /** Tool name; `bash` unless the case is about file effects. */
  readonly tool?: string
  /** Why this case exists. */
  readonly why: string
}

const CORPUS: readonly Case[] = [
  // ── R1 data-root-write: touching a real data root outside the checkout ──
  { rule: 'data-root-write', tool: 'write', text: 'write ~/.myapp/settings.json', why: 'writes an app data root' },
  { rule: 'data-root-write', text: 'rm -rf ~/.myapp/cache', why: 'deletes inside an app data root' },
  { rule: 'data-root-write', text: 'sqlite3 ~/.myapp/data/platform.db "delete from t"', why: 'mutates a real data root' },
  { rule: undefined, text: 'ls -la ~/Downloads', why: 'listing a home directory is ordinary work' },
  { rule: undefined, text: 'cat ~/.zshrc', why: 'reading a dotfile is ordinary work' },
  { rule: undefined, text: 'grep -rn "font" ~/.config/nvim', why: 'searching a config dir is read-only' },
  { rule: undefined, tool: 'write', text: 'write src/index.ts', why: 'writes inside the checkout' },

  // ── R2 secret-in-argv: a credential literal on the command line ──
  { rule: 'secret-in-argv', text: 'curl -H "Authorization: Bearer sk-abc123def456ghi789" https://x', why: 'token literal in argv' },
  { rule: 'secret-in-argv', text: 'mysql -h db -u root -pS3cretPass9 -e "select 1"', why: 'password literal in argv' },
  { rule: 'secret-in-argv', text: 'curl --token=ghp_abcdefghijklmnop https://x', why: 'token flag with a literal' },
  { rule: undefined, text: 'curl -H "Authorization: Bearer $API_TOKEN" https://x', why: 'the value comes from the environment' },
  { rule: undefined, text: 'echo "the password field needs validation"', why: 'the word appears in prose, not as a value' },
  { rule: undefined, text: 'grep -rn "apiKey" src/', why: 'searching for the word is not carrying a value' },
  { rule: undefined, text: 'node -e "console.log(process.env.HOME)"', why: 'no literal credential' },

  // ── R3 failure-as-evidence: a failed command read as a negative result ──
  { rule: 'failure-as-evidence', text: 'grep -rn TODO --include=*.ts src/', why: 'unquoted glob lets the shell expand it first' },
  { rule: 'failure-as-evidence', text: 'grep -rn TODO src 2>/dev/null | head -20', why: 'a silenced search piped onward' },
  { rule: 'failure-as-evidence', text: 'ugrep -Q "font" src/', why: 'a different pattern dialect than grep' },
  { rule: undefined, text: "grep -rn 'TODO' --include='*.ts' src/", why: 'quoted glob is the documented fix' },
  { rule: undefined, text: 'rg -n TODO src/', why: 'plain dialect, no redirect' },
  { rule: undefined, text: 'lsof -nP -iTCP:8899 -sTCP:LISTEN 2>/dev/null || echo "(not listening)"', why: 'the || fallback IS the error handling' },
  { rule: undefined, text: 'curl -s http://127.0.0.1:8899/x | head -1', why: 'an ordinary pipeline' },

  // ── R4 git-danger: mutating a shared checkout's index or worktree ──
  { rule: 'git-danger', text: 'git stash push -m "checkpoint"', why: 'stashes the shared index' },
  { rule: 'git-danger', text: 'git stash', why: 'bare stash means push' },
  { rule: 'git-danger', text: 'git stash pop', why: 'rewrites the working tree' },
  { rule: 'git-danger', text: 'git checkout main', why: 'switches the shared checkout' },
  { rule: 'git-danger', text: 'git add -A', why: 'stages everything in the checkout' },
  { rule: 'git-danger', text: 'git add .', why: 'same effect, different spelling' },
  { rule: 'git-danger', text: 'git commit -m "wip"', why: 'commits whatever another worker staged' },
  { rule: undefined, text: 'git stash list', why: 'reading the stash is a query — this one shipped as a false positive' },
  { rule: undefined, text: 'git stash show -p stash@{0}', why: 'also a query' },
  { rule: undefined, text: 'git status --short', why: 'everyday inspection' },
  { rule: undefined, text: 'git rev-parse --show-toplevel && git branch --show-current', why: 'everyday inspection' },
  { rule: undefined, text: 'git diff --cached --name-status', why: 'everyday inspection' },
  { rule: undefined, text: 'git log --oneline -20', why: 'everyday inspection' },
  { rule: undefined, text: 'git commit --only src/index.ts -m "msg"', why: 'the sanctioned path-scoped commit' },
  { rule: undefined, text: 'git checkout -b feat/x', why: 'creating a branch does not disturb the index' },

  // ── R5 high-impact-action: publishing, or wide destructive moves ──
  { rule: 'high-impact-action', text: 'npm publish --access public', why: 'publishing is irreversible outward' },
  { rule: 'high-impact-action', text: 'rm -rf /', why: 'the widest destructive move there is' },
  { rule: undefined, text: 'pnpm run build', why: 'ordinary build' },
  { rule: undefined, text: 'pnpm install', why: 'ordinary install' },
  { rule: undefined, text: 'rm -f /tmp/dsh-ops/x.log', why: 'deleting one temp file' },

  // ── R6 destructive-cleanup: removing a worktree that holds frozen work ──
  { rule: 'destructive-cleanup', text: 'git worktree remove --force .worktrees/x', why: 'forced removal discards uncommitted work' },
  { rule: 'destructive-cleanup', text: 'rm -rf .worktrees/x', why: 'same effect by hand' },
  { rule: undefined, text: 'git worktree list', why: 'listing worktrees is a query' },
  { rule: undefined, text: 'rm -rf node_modules', why: 'a rebuildable directory inside the checkout' },
  { rule: undefined, text: 'rm -rf /tmp/dsh-ops/tarballs', why: 'temp output, not a worktree' },
]

describe('shipped rule corpus', () => {
  for (const testCase of CORPUS) {
    const expectation = testCase.rule === undefined ? 'nothing fires' : testCase.rule
    it(`${testCase.rule === undefined ? 'quiet' : testCase.rule}: ${testCase.text.slice(0, 72)}`, () => {
      const decision = evaluateCall({ tool: testCase.tool ?? 'bash', text: testCase.text }, RULES)
      expect(
        decision.ruleId,
        `${expectation} — ${testCase.why}`,
      ).toBe(testCase.rule)
    })
  }
})
