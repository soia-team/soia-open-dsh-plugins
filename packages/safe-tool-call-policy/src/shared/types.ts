/**
 * Public types of the policy core. Kept free of any DSH import so the rule set
 * and the matcher can be reused by another host wrapper (a hook script, an MCP
 * server, a review tool) without dragging the harness types along.
 */

/**
 * What a rule does when it matches. `allow` exists only inside a project
 * override document, where it retires a rule by id; a rule that ships in
 * `danger-patterns.json` is never `allow`.
 */
export type PolicyAction = 'allow' | 'ask' | 'deny'

/** Action of an effective rule. A shipped rule is never `allow`: it either asks or denies. */
export type PolicyRuleAction = 'ask' | 'deny'

/**
 * Tool selector of a rule. A concrete name matches only that tool; `*` matches
 * every tool the call adapter reduces to a matchable text (see
 * {@link ToolCallShape}).
 */
export type PolicyToolSelector = 'bash' | 'write' | 'edit' | '*'

/** One danger rule, exactly as it appears in `danger-patterns.json`. */
export interface PolicyRule {
  /** Stable machine id; also the handle a project override replaces or disables. */
  readonly id: string
  readonly tool: PolicyToolSelector
  /** Regular expression source, matched against {@link ToolCallShape.text}. */
  readonly pattern: string
  /** What happens on a match. */
  readonly action: PolicyRuleAction
  /** One sentence telling the model why the call was stopped. */
  readonly reason: string
  /** One sentence telling the model how to do the same thing compliantly. */
  readonly remedy: string
  /** Where the rule came from — a real incident or rule reference, never a guess. */
  readonly source: string
}

/**
 * One tool call reduced to the part a pattern can see. The adapter owns the
 * reduction, so a rule author only has to know this shape:
 *
 * - `bash` → the command line the model asked to run.
 * - `write` / `edit` → `"<tool> <file_path>"`, so the tool name itself supplies
 *   the write verb; file *content* is deliberately not matchable.
 * - any other tool → an empty text, which matches nothing.
 */
export interface ToolCallShape {
  /** Tool name as the harness knows it, e.g. `bash`, `write`, `edit`. */
  readonly tool: string
  /** The single line rules are matched against. */
  readonly text: string
}

/** Outcome of one evaluation. `allow` carries no rule, and never carries a failure. */
export interface PolicyDecision {
  readonly action: PolicyAction
  /** Id of the deciding rule; present exactly when `action` is `ask` or `deny`. */
  readonly ruleId?: string
  /** The deciding rule's reason, as written in the rule set. */
  readonly reason?: string
  /** The deciding rule's one-line compliant alternative. */
  readonly remedy?: string
  /** Ids of every rule that matched, in rule order — useful for explain and tests. */
  readonly matched: readonly string[]
  /**
   * Fail-open and skip explanations: an unusable project config, an invalid
   * rule pattern, a rule that could not be understood. A note never blocks and
   * never changes `action`.
   */
  readonly notes: readonly string[]
}

/** A project override document, as read from `.dsh/policy.yml` or `.dsh/policy.json`. */
export interface PolicyDocument {
  /** Rules appended to the built-in list, or replacing a built-in rule with the same id. */
  readonly rules: readonly PolicyRuleOverride[]
  /** Built-in (or already appended) rule ids to remove. */
  readonly disable: readonly string[]
  /** Non-blocking explanations produced while reading the document. */
  readonly notes: readonly string[]
}

/** One entry of a project document's `rules:` list. */
export interface PolicyRuleOverride {
  readonly id: string
  readonly tool: PolicyToolSelector
  readonly pattern: string
  readonly action: PolicyAction
  readonly reason: string
  readonly remedy: string
  readonly source: string
}

/**
 * Effective rule set for one project root. `rules` is empty in exactly one
 * case: the project config exists but could not be used, and the policy fails
 * open rather than half-applying a document it could not read.
 */
export interface LoadedPolicy {
  readonly rules: readonly PolicyRule[]
  readonly notes: readonly string[]
  /** The project config file that supplied the override layer, when one did. */
  readonly sourcePath?: string
}
