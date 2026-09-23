/**
 * Recognise commands that can only read.
 *
 * The rules exist to stop work that changes state without a human looking. A
 * read-only command cannot change state, so asking about one is pure friction —
 * and the measured interception log says exactly that: of thirty-one blocked
 * calls, twenty-five were diagnostic searches (`grep -rn … --include=*.py .`,
 * `grep -rn "'approval/policy'" …/*.d.ts`). The operator's words were "the
 * privilege to diagnose was cut off", which is a fair description of a policy
 * that stops a read.
 *
 * The test is deliberately conservative — it fails closed (says "not read-only")
 * whenever it cannot prove the command only reads:
 *
 *  - every segment of the pipeline must start with a known read-only binary;
 *  - redirection of any kind disqualifies the whole command;
 *  - subcommands are checked where the binary is ambiguous (`git`, `sed`,
 *    `sqlite3`, `curl`, `find`);
 *  - anything the parser does not understand (substitution, grouping, a shell
 *    interpreter) disqualifies it.
 *
 * @param command - the command text a rule is deciding about.
 * @returns true only when the command provably cannot write.
 */

/** Binaries that never write, whatever their arguments. */
const READ_ONLY_BINARIES = new Set([
  'cat', 'head', 'tail', 'wc', 'ls', 'pwd', 'which', 'type', 'stat', 'file', 'du', 'df',
  'grep', 'rg', 'egrep', 'fgrep', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname',
  'realpath', 'readlink', 'date', 'whoami', 'id', 'env', 'printenv', 'jq', 'diff', 'cmp',
  'shasum', 'md5', 'sha256sum', 'awk', 'column', 'tree', 'ps', 'lsof', 'top', 'hostname',
  'sw_vers', 'uname', 'echo', 'printf', 'true', 'false', 'test', 'expr', 'seq', 'comm',
])

/** Read-only subcommands for binaries that can also write. */
const READ_ONLY_SUBCOMMANDS: Record<string, readonly string[]> = {
  git: ['log', 'status', 'diff', 'show', 'branch', 'rev-parse', 'describe', 'blame', 'ls-files', 'cat-file', 'config', 'remote', 'tag', 'stash', 'worktree', 'shortlog', 'whatchanged', 'grep', 'rev-list', 'symbolic-ref', 'for-each-ref'],
  sed: [],            // `sed` without -i still writes only stdout, handled below
  find: [],
  curl: [],
  sqlite3: [],
}

/**
 * Split a command line into its independently executed segments.
 * @param command - the whole command.
 * @returns each segment's text, trimmed, with empty entries dropped.
 */
function segments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\|/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Whether one segment provably only reads.
 * @param segment - one command segment.
 * @returns true when the segment cannot write.
 */
function isReadOnlySegment(segment: string): boolean {
  // Substitution and grouping change what runs: refuse to judge.
  if (/[`]|\$\(|[()]/.test(segment)) return false
  const words = segment.split(/\s+/)
  const [binary] = words
  if (binary === undefined || binary === '') return false
  // An interpreter in the command position can do anything — but the check is on
  // the command position only: `grep node` searches for the word, it does not run
  // node, and refusing to judge that would block exactly the diagnostic searches
  // this function exists to allow.
  if (/^(bash|sh|zsh|ksh|dash|python3?|node|deno|bun|perl|ruby|php|eval|exec|sudo|doas|nohup|time)$/.test(binary)) return false
  if (binary === 'env') return words.length === 1
  if (READ_ONLY_BINARIES.has(binary)) return true
  if (binary === 'sed') return !/(^|\s)-i\b/.test(segment)
  if (binary === 'find') return !/-(delete|exec|ok|fprint)/.test(segment)
  if (binary === 'curl') return !/(^|\s)(-X|--request|-d|--data|-F|--form|-T|--upload-file|-o|--output)\b/.test(segment)
  if (binary === 'sqlite3') return /-readonly\b/.test(segment)
  if (binary === 'git') {
    const subcommand = words[1] ?? ''
    // `git stash` is read-only only for the listing subcommands.
    if (subcommand === 'stash') return /^git\s+stash\s+(list|show)\b/.test(segment)
    if (subcommand === 'worktree') return /^git\s+worktree\s+list\b/.test(segment)
    if (subcommand === 'branch') return !/(^|\s)(-d|-D|-m|-M|--delete|--move)\b/.test(segment)
    if (subcommand === 'config') return !/(^|\s)(--add|--unset|--replace-all|--edit)\b/.test(segment)
    if (subcommand === 'tag') return !/(^|\s)(-d|--delete|-f|--force)\b/.test(segment)
    return (READ_ONLY_SUBCOMMANDS['git'] ?? []).includes(subcommand)
  }
  return false
}

/**
 * Whether a command provably only reads.
 * @param command - the command text.
 * @returns true when every segment is read-only and nothing is redirected.
 */
export function isReadOnlyCommand(command: string): boolean {
  const text = command.trim()
  if (text === '') return false
  // A redirect anywhere means this command writes somewhere.
  if (/(^|[^0-9])>{1,2}/.test(text)) return false
  const parts = segments(text)
  return parts.length > 0 && parts.every(isReadOnlySegment)
}
