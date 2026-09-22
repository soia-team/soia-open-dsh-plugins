import { describe, expect, it } from 'vitest'

import { matchingText } from '../../src/shared/projection.ts'
import { isReadOnlyCommand } from '../../src/shared/read-only.ts'

/**
 * Two shapes that produced real interceptions are pinned here.
 *
 * Both came out of a measured incident: of thirty-one blocked calls in live
 * sessions, twenty-five were read-only diagnostic searches, and one was a
 * command whose only "crime" was containing the words of a rule inside a
 * heredoc it was writing to a file. A policy that stops reads and stops talk
 * about git is not protecting anything.
 */
describe('read-only recognition', () => {
  const readOnly = [
    'grep -rn "assets_rescanned" --include=*.py .',
    "grep -rn \"'approval/policy'\" /usr/lib/node_modules/pkg/types/*.d.ts",
    'ls -la packages/check-ui-size',
    'git log --oneline -20',
    'git status --short',
    'git diff --name-status',
    'git stash list',
    'git worktree list',
    'cat /etc/hosts | head -3',
    'find . -newermt "-6 minutes" -type f',
    'sqlite3 -readonly ./data.db "select 1"',
    'curl -s http://127.0.0.1:8899/x | head -1',
    'ps ax -o pid=,command= | grep node',
  ]

  const notReadOnly = [
    'rm -rf build',
    'echo hi > file.txt',
    'git commit -m "x"',
    'git add -A',
    'git stash push -m wip',
    'git checkout main',
    'find . -delete',
    'curl -X POST http://x',
    'sed -i "" "s/a/b/" file.txt',
    'python3 - <<PY\nprint(1)\nPY',
    'bash -c "rm -rf /tmp/x"',
    'sqlite3 ./data.db "delete from t"',
    'pnpm install',
  ]

  for (const command of readOnly) {
    it(`reads only: ${command.slice(0, 60)}`, () => {
      expect(isReadOnlyCommand(command)).toBe(true)
    })
  }

  for (const command of notReadOnly) {
    it(`can write: ${command.slice(0, 60)}`, () => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })
  }

  it('fails closed on anything it cannot parse', () => {
    // Better to ask about a read than to wave through a write.
    expect(isReadOnlyCommand('$(cat /etc/hosts)')).toBe(false)
    expect(isReadOnlyCommand('(cd /tmp && ls)')).toBe(false)
    expect(isReadOnlyCommand('')).toBe(false)
    expect(isReadOnlyCommand('totally-unknown-binary --flag')).toBe(false)
  })
})

describe('command projection', () => {
  it('ignores prose that merely names an operation', () => {
    // The command that blocked this plugin's own author: it printed the rule.
    const printed = "echo \"r=[x for x in json.load(open('packages/p/danger-patterns.json')) if x['id']=='git-danger']\""
    expect(matchingText(printed)).not.toMatch(/git-danger|git\s+stash|git\s+commit/)
  })

  it('ignores a heredoc body written to a file', () => {
    const written = ["cat > /tmp/notes.md <<'EOF'", 'Run git commit -m x to save your work.', 'EOF'].join('\n')
    expect(matchingText(written)).not.toMatch(/git\s+commit/)
  })

  it('keeps a heredoc body handed to a shell', () => {
    const executed = ["bash -s <<'SCRIPT'", 'git commit -m wip', 'SCRIPT'].join('\n')
    expect(matchingText(executed)).toMatch(/git\s+commit/)
  })

  it('keeps a quoted command given to an interpreter', () => {
    expect(matchingText('sh -c "git commit -m x"')).toMatch(/git\s+commit/)
  })
})
