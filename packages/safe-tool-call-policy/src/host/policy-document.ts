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
import type {
  PolicyAction,
  PolicyDocument,
  PolicyRule,
  PolicyRuleOverride,
  PolicyToolSelector,
} from '../shared/types.ts'
import { PolicyConfigError } from './config-error.ts'
import { parseYamlSubset, TOP_LEVEL_KEYS } from './yaml-subset.ts'

/** Rule id shape: kebab-case, which is also what a `disable` entry must name. */
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Tool selectors a rule may declare. */
const TOOL_SELECTORS = new Set<PolicyToolSelector>(['bash', 'write', 'edit', '*'])

/** Actions an entry may declare; `allow` retires an existing rule. */
const ACTIONS = new Set<PolicyAction>(['allow', 'ask', 'deny'])

/** Fields of a rule entry; anything else is reported rather than ignored silently. */
const RULE_FIELDS = new Set(['id', 'tool', 'pattern', 'action', 'reason', 'remedy', 'source'])

/** One validated entry with any non-blocking notes, or a note explaining why it was dropped. */
export type RuleEntryResult =
  | { readonly rule: PolicyRuleOverride, readonly notes: readonly string[] }
  | { readonly error: string }

/** Narrowing helper for plain records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one own string field, trimmed; empty when absent or of another type. */
function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate one rule entry (from the project document or from the shipped file).
 *
 * @param value - the raw entry.
 * @param index - position in its list, used in notes.
 * @param allowedActions - actions the source may use; the shipped file allows
 *   only `ask` and `deny`, while a project document may also use `allow`.
 * @returns the validated entry, or the note explaining why it was dropped.
 */
export function validateRuleEntry(
  value: unknown,
  index: number,
  allowedActions: ReadonlySet<PolicyAction> = ACTIONS,
): RuleEntryResult {
  if (!isRecord(value)) return { error: `rules[${index}] is not a mapping and was skipped` }

  const id = stringField(value, 'id')

  if (!RULE_ID_PATTERN.test(id)) {
    return { error: `rules[${index}] has no usable id (expected kebab-case) and was skipped` }
  }

  const notes: string[] = []

  for (const key of Object.keys(value)) {
    if (!RULE_FIELDS.has(key)) notes.push(`rule "${id}": unknown field "${key}" was ignored`)
  }

  const actionField = stringField(value, 'action')

  if (!ACTIONS.has(actionField as PolicyAction) || !allowedActions.has(actionField as PolicyAction)) {
    return { error: `rule "${id}": action must be one of ${[...allowedActions].join('/')} and was skipped` }
  }

  const action = actionField as PolicyAction

  // `allow` only retires the rule of that id; it needs no pattern or wording.
  if (action === 'allow') {
    return {
      rule: { id, tool: '*', pattern: '', action, reason: '', remedy: '', source: stringField(value, 'source') },
      notes,
    }
  }

  const toolField = stringField(value, 'tool')
  const tool = toolField.length === 0 ? '*' : toolField

  if (!TOOL_SELECTORS.has(tool as PolicyToolSelector)) {
    return { error: `rule "${id}": tool must be one of bash/write/edit/* and was skipped` }
  }

  const pattern = stringField(value, 'pattern')

  if (pattern.length === 0) return { error: `rule "${id}": pattern is required and was skipped` }

  try {
    // Compile once so an unusable pattern is reported as a dropped rule instead
    // of throwing on every call; the compiled object itself is not needed here.
    RegExp(pattern)
  } catch {
    return { error: `rule "${id}": pattern is not a valid regular expression and was skipped` }
  }

  const reason = stringField(value, 'reason')
  const remedy = stringField(value, 'remedy')

  if (reason.length === 0) return { error: `rule "${id}": reason is required and was skipped` }
  if (remedy.length === 0) return { error: `rule "${id}": remedy is required and was skipped` }

  return {
    rule: {
      id,
      tool: tool as PolicyToolSelector,
      pattern,
      action,
      reason,
      remedy,
      source: stringField(value, 'source'),
    },
    notes,
  }
}

/** Turn a parsed value into a document, or throw when its shape is unusable. */
function documentFromValue(value: unknown, origin: string): PolicyDocument {
  if (!isRecord(value)) {
    throw new PolicyConfigError(`${origin}: the document must be a mapping with "rules" and/or "disable"`)
  }

  const notes: string[] = []
  const rules: PolicyRuleOverride[] = []
  const disable: string[] = []

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) notes.push(`${origin}: unknown top-level key "${key}" was ignored`)
  }

  const rawRules = value['rules']

  if (rawRules !== undefined) {
    if (!Array.isArray(rawRules)) throw new PolicyConfigError(`${origin}: "rules" must be a list`)

    for (const [index, entry] of rawRules.entries()) {
      const result = validateRuleEntry(entry, index)

      if ('rule' in result) {
        rules.push(result.rule)
        for (const note of result.notes) notes.push(`${origin}: ${note}`)
      } else {
        notes.push(`${origin}: ${result.error}`)
      }
    }
  }

  const rawDisable = value['disable']

  if (rawDisable !== undefined) {
    if (!Array.isArray(rawDisable)) throw new PolicyConfigError(`${origin}: "disable" must be a list`)

    for (const [index, entry] of rawDisable.entries()) {
      if (typeof entry !== 'string' || !RULE_ID_PATTERN.test(entry.trim())) {
        notes.push(`${origin}: disable[${index}] is not a rule id and was skipped`)
        continue
      }

      disable.push(entry.trim())
    }
  }

  return { rules, disable, notes }
}

/**
 * Parse and validate a project policy document.
 *
 * @param text - raw file content.
 * @param format - `json` for a `.json` file, `yaml` for a `.yml` file.
 * @param origin - path used in notes and error messages.
 * @returns the validated document with its notes.
 * @throws {PolicyConfigError} when the document cannot be used at all.
 */
export function parsePolicyDocument(text: string, format: 'json' | 'yaml', origin: string): PolicyDocument {
  let parsed: unknown

  if (format === 'json') {
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new PolicyConfigError(`${origin}: invalid JSON (${(error as Error).message})`)
    }
  } else {
    parsed = parseYamlSubset(text)
  }

  return documentFromValue(parsed, origin)
}

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
export function mergePolicyRules(
  builtin: readonly PolicyRule[],
  document: PolicyDocument,
): { rules: PolicyRule[], notes: string[] } {
  const rules: PolicyRule[] = [...builtin]
  const notes: string[] = []

  for (const override of document.rules) {
    const index = rules.findIndex((rule) => rule.id === override.id)

    if (override.action === 'allow') {
      if (index < 0) notes.push(`rule "${override.id}": nothing to retire with action allow`)
      else rules.splice(index, 1)

      continue
    }

    const merged: PolicyRule = {
      id: override.id,
      tool: override.tool,
      pattern: override.pattern,
      action: override.action,
      reason: override.reason,
      remedy: override.remedy,
      source: override.source.length > 0 ? override.source : 'project policy override',
    }

    if (index < 0) rules.push(merged)
    else rules[index] = merged
  }

  for (const id of document.disable) {
    const index = rules.findIndex((rule) => rule.id === id)

    if (index < 0) notes.push(`disable "${id}": no rule with that id`)
    else rules.splice(index, 1)
  }

  return { rules, notes }
}
