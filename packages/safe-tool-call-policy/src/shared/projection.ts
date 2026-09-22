/**
 * Project a shell command onto the part that actually runs.
 *
 * A substring matcher cannot tell `echo "git commit -m x"` (printing a sentence)
 * from `git commit -m x` (committing). The first is prose, the second is a
 * command, and treating them alike made this policy refuse to let anyone *talk*
 * about git — including a command whose only crime was echoing the rule's own
 * text. The replayed traffic named the same class: `cat > file <<'EOF' … 'git
 * commit' …` was flagged although the text is written to a file, not executed.
 *
 * What this removes, and what it deliberately keeps:
 *
 *  - **Heredoc bodies** are removed when the heredoc is data for a file writer
 *    (`cat >`, `tee`, `dd`), and kept when it is fed to a shell or interpreter
 *    (`bash`, `sh`, `zsh`, `python`, `node`, …) — because that text runs.
 *  - **`echo`/`printf` arguments** are removed: their arguments are output, not
 *    commands. `bash -c "…"` is untouched, so a quoted command still matches.
 *
 * The projection is only for matching. Reasons quote the original command.
 *
 * @param command - the command text a rule is deciding about.
 * @returns the same command with non-executed text blanked out.
 */

/** Interpreters whose heredoc input is executed rather than stored. */
const INTERPRETERS = /^(?:bash|sh|zsh|ksh|dash|python3?|node|deno|bun|perl|ruby|php)$/

/**
 * Whether the command feeding a heredoc runs its input.
 *
 * The check looks at **command words**, not at any word: `cat > notes.sh` writes
 * a file whose name merely ends in `.sh`, and an earlier version of this function
 * treated that as a shell, keeping a heredoc body that is only ever written.
 * @param consumer - the text before the heredoc operator.
 * @returns true when the input is executed.
 */
function executesHeredoc(consumer: string): boolean {
  return consumer
    .split(/\|\||&&|[|;&]/)
    .map((segment) => segment.trim().split(/\s+/)[0] ?? '')
    .some((word) => INTERPRETERS.test(word))
}

/**
 * Blank heredoc bodies that are written to a file.
 * @param command - raw command text.
 * @returns text with those bodies replaced by blank lines.
 */
function blankWrittenHeredocs(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (open === null) {
      out.push(line)
      continue
    }
    const delimiter = open[2] ?? ''
    const consumer = line.slice(0, open.index)
    const executes = executesHeredoc(consumer)
    out.push(line)
    index += 1
    for (; index < lines.length; index += 1) {
      const body = lines[index] ?? ''
      if (body.trim() === delimiter) {
        out.push(body)
        break
      }
      // Keep executed input verbatim; blank stored input while preserving lines.
      out.push(executes ? body : '')
    }
  }
  return out.join('\n')
}

/**
 * Blank the arguments of commands that only print them.
 * @param command - command text.
 * @returns text with those arguments removed.
 */
function blankPrintedArguments(command: string): string {
  let out = ''
  let index = 0
  while (index < command.length) {
    const match = /\b(?:echo|printf)\b/.exec(command.slice(index))
    if (match === null) {
      out += command.slice(index)
      break
    }
    const wordStart = index + match.index
    const argsStart = wordStart + match[0].length
    out += command.slice(index, argsStart)
    // Walk the arguments: quoted spans are skipped whole, and an unquoted run
    // ends at the first separator that would start a new command.
    let cursor = argsStart
    while (cursor < command.length) {
      const char = command[cursor] ?? ''
      if (char === '\\') {
        cursor += 2
        continue
      }
      if (char === "'" || char === '"') {
        const close = command.indexOf(char, cursor + 1)
        cursor = close === -1 ? command.length : close + 1
        continue
      }
      if (char === '\n' || char === ';' || char === '&' || char === '|') break
      cursor += 1
    }
    // Keep the line structure so later rules still see distinct commands.
    out += command.slice(argsStart, cursor).replaceAll(/[^\n]/g, ' ')
    index = cursor
  }
  return out
}

/**
 * Project a command onto its executable text for rule matching.
 * @param command - the command text a rule is deciding about.
 * @returns the projected text.
 */
export function matchingText(command: string): string {
  return blankPrintedArguments(blankWrittenHeredocs(command))
}
