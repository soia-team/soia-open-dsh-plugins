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
/**
 * Project a command onto its executable text for rule matching.
 * @param command - the command text a rule is deciding about.
 * @returns the projected text.
 */
export declare function matchingText(command: string): string;
