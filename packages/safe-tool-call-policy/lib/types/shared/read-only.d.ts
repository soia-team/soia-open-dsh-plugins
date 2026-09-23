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
/**
 * Whether a command provably only reads.
 * @param command - the command text.
 * @returns true when every segment is read-only and nothing is redirected.
 */
export declare function isReadOnlyCommand(command: string): boolean;
