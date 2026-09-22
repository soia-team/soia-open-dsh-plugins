/**
 * Structural classification of a tool call.
 *
 * The policy's rules are a text matcher: they fire on a pattern and say nothing
 * about the call as a whole, so they cannot answer the two questions that decide
 * whether a call needs a human — *what kind of change is this* and *how far does
 * it reach* — and they cannot be calibrated, because they have no notion of
 * confidence. This module produces that missing judgement from the command's
 * structure instead of from its spelling.
 *
 * It is deliberately a classifier and not a matcher:
 *
 *  - the output is typed (`action`, `target`, `blastRadius`, `reversible`,
 *    `credentialAccess`) plus a `confidence` and the `evidence` that produced it;
 *  - it never decides. Enforcement is a separate policy decision, so the same
 *    judgement can first be logged and calibrated against real traffic (the field
 *    practice for risk gating is to observe before blocking);
 *  - it is offline and cheap, so it can run on every call.
 *
 * @module safe-tool-call-policy/shared/classify
 */

/** What the call does to the world. */
export type ActionClass =
  | 'read'
  | 'write'
  | 'delete'
  | 'move'
  | 'network'
  | 'publish'
  | 'execute'
  | 'unknown'

/** Where the call acts, from least to most protected. */
export type TargetClass =
  | 'workspace'
  | 'scratch'
  | 'data-root'
  | 'system'
  | 'remote'
  | 'unknown'

/** How far a change reaches if it goes wrong. */
export type BlastRadius = 'single' | 'tree' | 'machine' | 'outward'

/** One typed judgement about a call. */
export interface CommandJudgement {
  /** Dominant action across the call's segments. */
  readonly action: ActionClass
  /** Most protected target the call touches. */
  readonly target: TargetClass
  /** Reach of a mistake, given the action and target. */
  readonly blastRadius: BlastRadius
  /** False when the action cannot be undone by the caller. */
  readonly reversible: boolean
  /** True when the call reads or transmits a credential. */
  readonly credentialAccess: boolean
  /** 0..1 — how much of the call the classifier could account for. */
  readonly confidence: number
  /** The signals behind the judgement, for a reader and for calibration. */
  readonly evidence: readonly string[]
}

/** Verbs that act, grouped by what they do. */
const ACTIONS: Record<ActionClass, readonly string[]> = {
  read: ['cat', 'head', 'tail', 'less', 'ls', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'stat', 'file', 'wc', 'sort', 'uniq', 'cut', 'awk', 'jq', 'diff', 'du', 'df', 'ps', 'lsof', 'readlink', 'realpath', 'sed', 'echo', 'printf', 'which', 'type', 'env', 'printenv'],
  write: ['tee', 'touch', 'mkdir', 'truncate', 'dd', 'install', 'chmod', 'chown', 'ln', 'cp', 'rsync', 'write', 'edit', 'patch'],
  delete: ['rm', 'rmdir', 'unlink', 'shred', 'git-rm'],
  move: ['mv', 'rename'],
  network: ['curl', 'wget', 'ssh', 'scp', 'nc', 'ncat', 'telnet', 'openssl'],
  publish: ['npm', 'pnpm', 'yarn', 'bun', 'twine', 'cargo', 'gem', 'pip', 'gh'],
  execute: ['node', 'deno', 'bun', 'python', 'python3', 'bash', 'sh', 'zsh', 'make', 'docker', 'kubectl', 'systemctl', 'launchctl', 'npx', 'vitest', 'jest', 'tsc'],
  unknown: [],
}

/** Verbs whose network use is only network when they actually leave the machine. */
const LOCAL_HOSTS = /(?:^|\/\/|@)(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/

/** Where a path lives; order matters, first match wins. */
const TARGETS: readonly (readonly [TargetClass, RegExp])[] = [
  ['scratch', /^(?:\/tmp\/|\/var\/folders\/|\$?TMPDIR|\.\/?scratch\/|\/private\/tmp\/)/],
  ['data-root', /^(?:~|\$HOME|\$DSH_HOME|\/Users\/[^/]+|\/home\/[^/]+)\/\.[\w.-]+/],
  ['system', /^(?:\/etc\/|\/usr\/|\/var\/|\/System\/|\/Library\/|\/opt\/|\/sbin\/)/],
  ['remote', /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/],
]

/** Environment secrets a command might print instead of a file. */
const CREDENTIAL_HINTS = /\b(?:AWS_SECRET|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|API_KEY|SECRET_KEY|PASSWORD|CREDENTIALS?)\b/
/** Files that hold credentials. */
const CREDENTIAL_PATHS = /(?:\.aws\/credentials|\.ssh\/id_|\.netrc|\.npmrc|\.pypirc|\.docker\/config\.json|keychain|login\.keychain)/
/** Flags that turn an ordinary action irreversible. */
const FORCE_FLAGS = /(^|\s)(?:-f|--force|-D|--hard|--mirror)(\s|$)/
/** Operations that cannot be walked back. */
const IRREVERSIBLE_SUBCOMMANDS = /\b(?:push\s+--force|push\s+-f|reset\s+--hard|clean\s+-[a-z]*f|filter-branch|filter-repo|gc\s+--prune)\b/

/**
 * Split a command into independently executed segments.
 * @param command - the whole command text.
 * @returns non-empty segments, trimmed.
 */
function segments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\|(?!\|)/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * The words of one segment, without the `sudo`/`time` prefix that hides the verb.
 * @param segment - one command segment.
 * @returns its words.
 */
function wordsOf(segment: string): string[] {
  const words = segment.split(/\s+/).filter((word) => word !== '')
  return words[0] !== undefined && /^(?:sudo|doas|time|nice|xargs)$/.test(words[0]) ? words.slice(1) : words
}

/**
 * Classify the action of one segment.
 * @param words - the segment's words.
 * @returns the action class, and whether the verb was recognised.
 */
function actionOf(words: string[]): { action: ActionClass, known: boolean } {
  const verb = words[0] ?? ''
  if (verb === 'git') {
    const sub = words[1] ?? ''
    if (/^(?:rm)$/.test(sub)) return { action: 'delete', known: true }
    if (/^(?:mv)$/.test(sub)) return { action: 'move', known: true }
    if (/^(?:push|fetch|pull|clone|remote|submodule)$/.test(sub)) return { action: 'network', known: true }
    if (/^(?:clean|reset|checkout|switch|restore|stash|worktree)$/.test(sub)) return { action: 'delete', known: true }
    if (/^(?:commit|add|merge|rebase|cherry-pick|apply|tag)$/.test(sub)) return { action: 'write', known: true }
    if (/^(?:log|status|diff|show|branch|rev-parse|describe|blame|ls-files|cat-file|config|grep|rev-list|shortlog|for-each-ref|symbolic-ref|worktree)$/.test(sub)) return { action: 'read', known: true }
    return { action: 'write', known: false }
  }
  if (verb === 'sqlite3' || verb === 'psql' || verb === 'mysql') {
    return /\b(?:delete|drop|update|insert|alter|create|replace|truncate|vacuum)\b/i.test(words.join(' '))
      ? { action: 'write', known: true }
      : { action: 'read', known: true }
  }
  for (const [action, verbs] of Object.entries(ACTIONS) as [ActionClass, readonly string[]][]) {
    if (!verbs.includes(verb)) continue
    if (action === 'publish') {
      // `npm run build` is not a publish; `npm publish` is — and a package
      // manager running a script is an execution, not a matcher gap.
      const sub = words[1] ?? ''
      const publishes = sub === 'publish' || sub === 'release' || sub === 'deploy' || sub === 'dist-tag'
      if (!publishes) return { action: 'execute', known: true }
    }
    if (action === 'network' && verb === 'curl') {
      // A request to loopback without a body stays local.
      const text = words.join(' ')
      if (LOCAL_HOSTS.test(text) && !/(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)/i.test(text)) continue
    }
    return { action, known: true }
  }
  return { action: 'unknown', known: false }
}

/**
 * Classify one path-like word.
 * @param word - the word, quotes already stripped by the caller.
 * @returns its target class, or null when it is not path-like.
 */
function targetOf(word: string): TargetClass | null {
  const cleaned = word.replace(/^['"]|['"]$/g, '')
  if (cleaned === '' || cleaned.startsWith('-')) return null
  for (const [target, pattern] of TARGETS) {
    if (pattern.test(cleaned)) return target
  }
  if (cleaned.includes('/') || cleaned.startsWith('./') || cleaned.startsWith('../')) return 'workspace'
  return null
}

/** Ranking so the most protected target wins across segments. */
const TARGET_RANK: Record<TargetClass, number> = { unknown: 0, workspace: 1, scratch: 2, remote: 3, 'data-root': 4, system: 5 }

/**
 * Classify a tool call's command text.
 *
 * @param command - the command text a rule would otherwise be matched against.
 * @returns a typed judgement; never throws, and reports low confidence rather
 *   than guessing when the call is not understood.
 */
export function classifyCommand(command: string): CommandJudgement {
  const parts = segments(command)
  const evidence: string[] = []
  let known = 0
  let credentialAccess = false
  let irreversible = false
  let action: ActionClass = 'read'
  let target: TargetClass = 'unknown'
  let broadDelete = false

  for (const segment of parts) {
    const words = wordsOf(segment)
    const verbs = words[0] === 'git' ? `git ${words[1] ?? ''}` : words[0] ?? ''
    const classified = actionOf(words)
    if (classified.known) known += 1
    // A redirect writes, whatever the verb prints: `cat > /etc/hosts` is a write.
    const redirects = /(^|[^0-9])>{1,2}/.test(segment)
    const effective: ActionClass = redirects && (classified.action === 'read' || classified.action === 'unknown')
      ? 'write'
      : classified.action
    if (effective !== 'read') action = effective
    else if (action === 'unknown') action = 'read'

    for (const word of words.slice(1)) {
      const found = targetOf(word)
      if (found !== null && TARGET_RANK[found] > TARGET_RANK[target]) {
        target = found
        evidence.push(`target ${found}: ${word.slice(0, 40)}`)
      }
    }

    // Git acts on the repository it is run in, and `push`/`fetch`/`clone` reach a
    // remote that is named by an alias rather than by a URL-shaped word.
    if (words[0] === 'git') {
      const sub = words[1] ?? ''
      const implied: TargetClass = /^(?:push|fetch|pull|clone|remote|submodule|ls-remote)$/.test(sub) ? 'remote' : 'workspace'
      if (TARGET_RANK[implied] > TARGET_RANK[target]) target = implied
    }

    if (effective === 'delete' && /(^|\s)-[a-z]*r[a-z]*f|(^|\s)-[a-z]*f[a-z]*r/.test(segment)) broadDelete = true
    if (FORCE_FLAGS.test(` ${segment}`) && effective !== 'read') irreversible = true
    if (IRREVERSIBLE_SUBCOMMANDS.test(segment)) irreversible = true
    if (CREDENTIAL_HINTS.test(segment) || CREDENTIAL_PATHS.test(segment)) credentialAccess = true
    if (verbs !== '') evidence.push(`verb ${verbs}`)
  }

  const outward = action === 'publish' || (action === 'network' && target === 'remote')
  const blastRadius: BlastRadius = outward
    ? 'outward'
    : broadDelete && (target === 'data-root' || target === 'system')
      ? 'machine'
      : broadDelete
        ? 'tree'
        : 'single'

  const reversible = !(irreversible
    || outward
    || (action === 'delete' && (target === 'data-root' || target === 'system')))

  // Confidence describes how much of the call was accounted for, not how likely
  // the judgement is correct: an unparsed call scores low so calibration can put
  // it in a bucket of its own instead of trusting it.
  let confidence = parts.length === 0 ? 0 : known / parts.length
  if (target !== 'unknown') confidence = Math.min(0.95, confidence + 0.1)
  if (action === 'unknown') confidence = Math.min(confidence, 0.3)

  return {
    action,
    target,
    blastRadius,
    reversible,
    credentialAccess,
    confidence: Number(confidence.toFixed(2)),
    evidence,
  }
}
