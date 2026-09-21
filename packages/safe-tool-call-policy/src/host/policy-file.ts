/**
 * Filesystem side of the policy: locate a project's `.dsh/policy.yml` (or
 * `.dsh/policy.json`), read it next to the shipped `danger-patterns.json`, and
 * return one effective rule set.
 *
 * This module is the only place that touches disk, and it never throws. Its
 * two failure modes are both fail-open, because a policy that cannot read its
 * own inputs must not become a new way for a call to fail:
 *
 * - The project file exists but cannot be read or parsed → **no rule applies**
 *   and the note says why. Falling back to the built-in list would be worse: the
 *   project may have been disabling or loosening exactly those rules.
 * - The shipped pattern set cannot be read → no rule applies, with a note. That
 *   file is part of the package, so this only happens on a broken install.
 *
 * A missing project file is not a failure: the built-in list is the default.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LoadedPolicy, PolicyRule } from '../shared/types.ts'
import { parsePolicyDocument, mergePolicyRules, validateRuleEntry } from './policy-document.ts'

/** Project policy files, in precedence order: the first one that exists is authoritative. */
const POLICY_FILES: readonly { readonly file: string, readonly format: 'json' | 'yaml' }[] = [
  { file: 'policy.yml', format: 'yaml' },
  { file: 'policy.json', format: 'json' },
]

/** Actions the shipped pattern set may use; `allow` belongs to project overrides only. */
const BUILTIN_ACTIONS = new Set<'ask' | 'deny'>(['ask', 'deny'])

/** One resolved project policy file. */
export interface PolicyFile {
  readonly path: string
  readonly format: 'json' | 'yaml'
}

/** Inputs of one policy load. */
export interface LoadPolicyOptions {
  /** Project root: the session workspace, i.e. the directory that owns `.dsh/`. */
  readonly projectRoot: string
  /** Location of the shipped `danger-patterns.json`. */
  readonly builtinUrl: URL
}

/**
 * Resolve the project policy file under `projectRoot`, if any.
 *
 * @param projectRoot - directory that would contain `.dsh/`.
 * @returns the first existing candidate, or `undefined`.
 */
export function findPolicyFile(projectRoot: string): PolicyFile | undefined {
  try {
    for (const candidate of POLICY_FILES) {
      const path = join(projectRoot, '.dsh', candidate.file)

      if (existsSync(path)) return { path, format: candidate.format }
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * Read and validate the shipped pattern set.
 *
 * @param builtinUrl - URL of `danger-patterns.json`.
 * @returns the rules, or an empty list plus one note when the file is unusable.
 */
export function readBuiltinRules(builtinUrl: URL): { rules: PolicyRule[], notes: string[] } {
  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(builtinUrl, 'utf8'))
  } catch (error) {
    return {
      rules: [],
      notes: [`shipped danger-pattern set is unreadable (${(error as Error).message}); no rule applies`],
    }
  }

  if (!Array.isArray(parsed)) {
    return { rules: [], notes: ['shipped danger-pattern set is not a list; no rule applies'] }
  }

  const rules: PolicyRule[] = []
  const notes: string[] = []

  for (const [index, entry] of parsed.entries()) {
    const result = validateRuleEntry(entry, index, BUILTIN_ACTIONS)

    if (!('rule' in result)) {
      notes.push(`shipped danger-pattern set: ${result.error}`)
      continue
    }

    const rule = result.rule

    if (rule.action === 'allow') {
      notes.push(`shipped danger-pattern set: rules[${index}] uses action allow, which only a project override may use`)
      continue
    }

    rules.push({
      id: rule.id,
      tool: rule.tool,
      pattern: rule.pattern,
      action: rule.action,
      reason: rule.reason,
      remedy: rule.remedy,
      source: rule.source,
    })
  }

  return { rules, notes }
}

/**
 * Load the effective policy for one project root.
 *
 * @param options - project root and the shipped pattern-set location.
 * @returns the effective rules plus every fail-open note. Never throws.
 */
export function loadPolicy(options: LoadPolicyOptions): LoadedPolicy {
  const builtin = readBuiltinRules(options.builtinUrl)
  const file = findPolicyFile(options.projectRoot)

  if (file === undefined) return { rules: builtin.rules, notes: builtin.notes }

  let text: string

  try {
    text = readFileSync(file.path, 'utf8')
  } catch (error) {
    return {
      rules: [],
      notes: [
        ...builtin.notes,
        `project policy ${file.path} is unreadable (${(error as Error).message}); fail-open, no rule applies`,
      ],
      sourcePath: file.path,
    }
  }

  try {
    const document = parsePolicyDocument(text, file.format, file.path)
    const merged = mergePolicyRules(builtin.rules, document)

    return {
      rules: merged.rules,
      notes: [...builtin.notes, ...document.notes, ...merged.notes],
      sourcePath: file.path,
    }
  } catch (error) {
    return {
      rules: [],
      notes: [...builtin.notes, `project policy ${file.path} is unusable (${(error as Error).message}); fail-open, no rule applies`],
      sourcePath: file.path,
    }
  }
}
