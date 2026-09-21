/**
 * Project override documents: parse a `.dsh/policy.yml` / `.dsh/policy.json`
 * body, validate it, and merge it over the built-in rule list.
 *
 * Everything here is pure — text in, rules and notes out — so the merge rules
 * are testable without a filesystem and without running a single command.
 *
 * Failure policy, in one place:
 *
 * - **Unusable document** (unparsable text, wrong top-level shape) throws
 *   {@link PolicyConfigError}. The caller fails open with a note: a config that
 *   cannot be read must not half-apply, because the project's intent is unknown.
 * - **Unusable entry** (missing field, unknown action, uncompilable pattern) is
 *   dropped with a note, and every other rule still applies.
 */
import type { PolicyAction, PolicyDocument, PolicyRule, PolicyRuleOverride } from '../shared/types.ts';
/** One validated entry with any non-blocking notes, or a note explaining why it was dropped. */
export type RuleEntryResult = {
    readonly rule: PolicyRuleOverride;
    readonly notes: readonly string[];
} | {
    readonly error: string;
};
/**
 * Validate one rule entry (from the project document or from the shipped file).
 *
 * @param value - the raw entry.
 * @param index - position in its list, used in notes.
 * @param allowedActions - actions the source may use; the shipped file allows
 *   only `ask` and `deny`, while a project document may also use `allow`.
 * @returns the validated entry, or the note explaining why it was dropped.
 */
export declare function validateRuleEntry(value: unknown, index: number, allowedActions?: ReadonlySet<PolicyAction>): RuleEntryResult;
/**
 * Parse and validate a project policy document.
 *
 * @param text - raw file content.
 * @param format - `json` for a `.json` file, `yaml` for a `.yml` file.
 * @param origin - path used in notes and error messages.
 * @returns the validated document with its notes.
 * @throws {PolicyConfigError} when the document cannot be used at all.
 */
export declare function parsePolicyDocument(text: string, format: 'json' | 'yaml', origin: string): PolicyDocument;
/**
 * Merge the project override layer over the built-in rules.
 *
 * `rules` entries are applied first: an entry whose id already exists replaces
 * that rule where it stands (so a project can loosen a shipped `deny` to `ask`),
 * and an entry with a new id is appended. `disable` ids are applied second and
 * always win, so a project can disable anything, including a rule it just
 * appended.
 *
 * @param builtin - the effective rules before the project layer.
 * @param document - the parsed project document.
 * @returns the merged rule list and the notes produced by merging.
 */
export declare function mergePolicyRules(builtin: readonly PolicyRule[], document: PolicyDocument): {
    rules: PolicyRule[];
    notes: string[];
};
