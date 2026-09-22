/**
 * Incident corpus: the commands this policy actually intercepted, replayed
 * against the fixed rules.
 *
 * Every case below is a shape taken from a measured interception in a live
 * session — thirty-one of them, in six sessions, all decided by the host within
 * 0–4 ms because those sessions had approvals disabled. The commands are
 * genericized (paths renamed, worktrees anonymised) because they came from a real
 * machine, but the *shape* that made a rule fire is preserved exactly.
 *
 * The point of the file is regression: these were all flagged before, and only
 * the ones that name a real hazard may be flagged again. The `why` field records
 * which incident each case came from, so a future change that reintroduces the
 * noise has to argue with the incident, not with a hypothetical.
 */
export interface Incident {
  /** The command shape, genericized. */
  readonly command: string
  /** The verdict the fixed rules must reach. */
  readonly expect: 'allow' | 'ask' | 'deny'
  /** Which incident this came from. */
  readonly why: string
}

export const INCIDENTS: readonly Incident[] = [
  // ── the 25 read-only diagnostics that were stopped ──────────────────────
  {
    command: 'grep -rn "assets_rescanned" --include=*.py .',
    expect: 'allow',
    why: 'incident: a read-only search inside the caller\'s own worktree',
  },
  {
    command: 'find . -newermt "-60 minutes" -type f 2>/dev/null | head -20',
    expect: 'allow',
    why: 'incident: the most common remaining hit — a normal diagnostic, stderr discarded',
  },
  {
    command: 'grep -rn "bridge-create-import" --include=*.py . | grep -v node_modules',
    expect: 'allow',
    why: 'incident: the same search narrowed with a second grep',
  },
  {
    command: 'grep -rn "\'approval/policy\'" /usr/lib/node_modules/pkg/lib/types/*.d.ts 2>/dev/null',
    expect: 'allow',
    why: 'incident: reading a dependency\'s type definitions, stderr discarded but nothing piped',
  },
  {
    command: 'grep -rn "rawJson" src/ | head -40',
    expect: 'allow',
    why: 'incident: paging a search result',
  },
  {
    command: 'find . -newermt "-6 minutes" -type f -not -path "*/node_modules/*"',
    expect: 'allow',
    why: 'incident: looking for recently written files',
  },
  {
    command: 'git log --oneline -20 && git status --short',
    expect: 'allow',
    why: 'incident: the inspection that was blocked as a "shared checkout" mutation',
  },
  {
    command: 'git stash list',
    expect: 'allow',
    why: 'incident: reading the stash, not writing it',
  },
  {
    command: 'ls -la worktrees/active && du -sh worktrees/active',
    expect: 'allow',
    why: 'incident: sizing a worktree',
  },
  {
    command: 'sqlite3 -readonly ./data.db "select count(*) from sessions"',
    expect: 'allow',
    why: 'incident: reading a database in read-only mode',
  },
  {
    command: 'curl -s http://127.0.0.1:8899/second-case.html | head -1',
    expect: 'allow',
    why: 'incident: fetching a local page to check it is up',
  },
  {
    command: 'ps ax -o pid=,command= | grep -i "some-binary"',
    expect: 'allow',
    why: 'incident: finding a running process',
  },
  {
    command: 'lsof -nP -iTCP:8899 -sTCP:LISTEN',
    expect: 'allow',
    why: 'incident: checking whether a port is in use',
  },

  // ── the prose and heredoc false positives ──────────────────────────────
  {
    command: 'echo "run git add -A to stage everything"',
    expect: 'allow',
    why: 'incident: printing the rule text, not running the command',
  },
  {
    command: 'cat > /tmp/notes.sh <<\'EOF\'\ngit stash push -m wip\nEOF',
    expect: 'allow',
    why: 'incident: writing a script to a file',
  },

  // ── the ordinary git work that was stopped ─────────────────────────────
  {
    command: 'git commit -m "feat(navigation): rail groups become data-driven"',
    expect: 'allow',
    why: 'incident: a normal commit in the caller\'s own worktree (85 of 239 git hits)',
  },
  {
    command: 'git checkout -b fix/panel-alignment',
    expect: 'allow',
    why: 'incident: creating a branch (109 of 239 git hits)',
  },
  {
    command: 'git add packages/a/src/index.ts && git commit --only packages/a/src/index.ts -m "x"',
    expect: 'allow',
    why: 'incident: the sanctioned path-scoped form of the same operation',
  },

  // ── shipping work that must not be stopped ─────────────────────────────
  {
    command: 'pnpm install',
    expect: 'allow',
    why: 'incident: installing dependencies',
  },
  {
    command: 'rm -rf /tmp/dsh-ops/plugin-fixtures',
    expect: 'allow',
    why: 'incident: clearing a scratch directory',
  },
  {
    command: 'mkdir -p /tmp/build-artifacts && cp -R dist/ /tmp/build-artifacts/',
    expect: 'allow',
    why: 'incident: packaging into a scratch directory',
  },

  // ── and the hazards that must still stop ───────────────────────────────
  {
    command: 'rm -rf ~/.myapp/cache',
    expect: 'deny',
    why: 'hazard: deleting inside a real application-data root',
  },
  {
    command: 'rm -rf /Users/someone/.myapp/cache',
    expect: 'deny',
    why: 'hazard: the same deletion written with an expanded home path',
  },
  {
    command: 'cat > /etc/hosts <<\'EOF\'\n127.0.0.1 example\nEOF',
    expect: 'deny',
    why: 'hazard: writing a system file',
  },
  {
    command: 'curl -H "Authorization: Bearer sk-abcdefghijklmnopqrst" https://example.invalid',
    expect: 'deny',
    why: 'hazard: a credential literal on the command line',
  },
  {
    command: 'git add -A && git commit -a -m "wip"',
    expect: 'ask',
    why: 'hazard: taking the whole shared index',
  },
  {
    command: 'git worktree remove --force .worktrees/task',
    expect: 'ask',
    why: 'hazard: discarding a worktree that may hold frozen work',
  },
  {
    command: 'npm publish --access public',
    expect: 'ask',
    why: 'hazard: an irreversible outward action',
  },
]
