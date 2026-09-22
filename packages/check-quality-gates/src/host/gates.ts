/**
 * Gate core: parse the caller's config, match changed files against every gate,
 * and assemble the report. Pure functions only — no filesystem, no host import,
 * so every rule here is testable without touching a disk or a harness.
 *
 * The package ships no gate of its own. A gate exists only because the caller
 * declared it in `.dsh/gates.yml`; nothing about a project's scripts, paths, or
 * evidence format is built in.
 */
import {
  GATE_CONFIG_FILE_NAME,
  GATE_CONFIG_NOT_FOUND,
  type GateDefinition,
  type GateFailureCode,
  type GateReport,
  type RequiredGate,
} from '../shared/types.ts'
import { matchesGlob, normalizePath } from './glob.ts'
import { YamlError, parseYamlSubset, type YamlValue } from './yaml.ts'

/** Keys a gate entry may carry. Anything else is a typo and is rejected. */
const GATE_KEYS = ['id', 'command', 'reason', 'rawEvidenceRequired', 'when'] as const

/** Keys the `when` block may carry. */
const WHEN_KEYS = ['paths'] as const

/** Keys the document root may carry. */
const ROOT_KEYS = ['gates'] as const

/**
 * A config file that could not be used. Carries the source line when the
 * failure is syntactic; the message is written to be pasted into a report.
 */
export class GateConfigError extends Error {
  /** 1-based config line, when the failure has one. */
  readonly line: number | undefined

  constructor(message: string, line?: number) {
    super(message)
    this.name = 'GateConfigError'
    this.line = line
  }
}

/** A parsed-but-unvalidated document is a plain object. */
type Mapping = { [key: string]: YamlValue }

/** Whether one value is a mapping (not null, not an array, not a scalar). */
function isMapping(value: YamlValue | undefined): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require a mapping, with a readable scope-qualified message. */
function requireMapping(value: YamlValue | undefined, scope: string): Mapping {
  if (value === undefined) throw new GateConfigError(`${scope}: missing required key`)
  if (!isMapping(value)) throw new GateConfigError(`${scope}: expected a mapping`)
  return value
}

/** Reject keys outside the documented schema, so a typo cannot pass silently. */
function assertKnownKeys(mapping: Mapping, allowed: readonly string[], scope: string): void {
  for (const key of Object.keys(mapping)) {
    if (!allowed.includes(key)) {
      throw new GateConfigError(`${scope}: unknown key "${key}" (allowed: ${allowed.join(', ')})`)
    }
  }
}

/** Require a non-empty string field. */
function requireString(mapping: Mapping, key: string, scope: string): string {
  const value = mapping[key]
  if (value === undefined || value === null) throw new GateConfigError(`${scope}: missing required key "${key}"`)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GateConfigError(`${scope}.${key}: must be a non-empty string`)
  }
  return value.trim()
}

/** Validate one gate entry. */
function parseGate(entry: YamlValue | undefined, scope: string): GateDefinition {
  const gate = requireMapping(entry, `${scope}`)
  assertKnownKeys(gate, GATE_KEYS, scope)
  const id = requireString(gate, 'id', scope)
  const command = requireString(gate, 'command', scope)
  const reason = requireString(gate, 'reason', scope)
  const rawEvidenceRequired = requireString(gate, 'rawEvidenceRequired', scope)

  const when = gate['when']
  if (when === undefined) throw new GateConfigError(`${scope}: missing required key "when"`)
  const whenMapping = requireMapping(when, `${scope}.when`)
  assertKnownKeys(whenMapping, WHEN_KEYS, `${scope}.when`)
  const rawPaths = whenMapping['paths']
  if (rawPaths === undefined || rawPaths === null) {
    throw new GateConfigError(`${scope}.when: missing required key "paths"`)
  }
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    throw new GateConfigError(`${scope}.when.paths: must be a non-empty list of glob strings`)
  }
  const paths = rawPaths.map((pattern, index) => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      throw new GateConfigError(`${scope}.when.paths[${index}]: must be a non-empty glob string`)
    }
    return pattern.trim()
  })

  return { id, command, reason, rawEvidenceRequired, paths }
}

/**
 * Parse and validate a gate config.
 * @param text - Config file contents.
 * @returns The declared gates, in the order they appear in the file.
 * @throws GateConfigError On a syntax error outside the supported YAML subset, a
 * missing or mistyped field, an unknown key, or a duplicate gate id.
 */
export function parseGateConfig(text: string): GateDefinition[] {
  let document: YamlValue
  try {
    document = parseYamlSubset(text)
  } catch (error) {
    if (error instanceof YamlError) throw new GateConfigError(error.message, error.line)
    throw error
  }

  const root = requireMapping(document, 'config root')
  assertKnownKeys(root, ROOT_KEYS, 'config root')
  if (!('gates' in root)) throw new GateConfigError('config root: missing required key "gates"')
  const rawGates = root['gates']
  if (rawGates === null) return []
  if (!Array.isArray(rawGates)) throw new GateConfigError('config root: "gates" must be a list of gate mappings')

  const gates = rawGates.map((entry, index) => parseGate(entry, `gates[${index}]`))
  const seen = new Map<string, number>()
  for (const [index, gate] of gates.entries()) {
    const first = seen.get(gate.id)
    if (first !== undefined) {
      throw new GateConfigError(`duplicate gate id "${gate.id}" (gates[${first}] and gates[${index}])`)
    }
    seen.set(gate.id, index)
  }
  return gates
}

/**
 * Normalize the caller's changed-file list: trimmed, `\` separators folded to
 * `/`, blanks dropped, duplicates removed, sorted for a stable report.
 * @param files - Files the caller says this task changed.
 * @returns The canonical list every other function here works on.
 */
export function normalizeChangedFiles(files: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const file of files) {
    const normalized = normalizePath(file)
    if (normalized !== '') unique.add(normalized)
  }
  return [...unique].toSorted()
}

/** Whether one changed file is selected by any pattern of one gate. */
function gateSelects(gate: GateDefinition, file: string): boolean {
  return gate.paths.some((pattern) => matchesGlob(file, pattern))
}

/**
 * Select the gates at least one changed file requires.
 *
 * Order is the config order, which makes the report stable across runs and
 * independent of the order the caller listed its files in. A gate matched by
 * several files appears once.
 * @param changedFiles - Normalized changed files.
 * @param gates - Declared gates, in config order.
 * @returns One entry per required gate.
 */
export function selectRequiredGates(
  changedFiles: readonly string[],
  gates: readonly GateDefinition[],
): RequiredGate[] {
  const required: RequiredGate[] = []
  for (const gate of gates) {
    if (!changedFiles.some((file) => gateSelects(gate, file))) continue
    required.push({
      id: gate.id,
      command: gate.command,
      reason: gate.reason,
      rawEvidenceRequired: gate.rawEvidenceRequired,
    })
  }
  return required
}

/**
 * Select the changed files no gate selected. Reported instead of dropped, so an
 * unconfigured area of the workspace is visible rather than silently ungated.
 * @param changedFiles - Normalized changed files.
 * @param gates - Declared gates.
 * @returns The unmatched files, deduplicated and sorted.
 */
export function selectUnmatchedFiles(
  changedFiles: readonly string[],
  gates: readonly GateDefinition[],
): string[] {
  return changedFiles.filter((file) => !gates.some((gate) => gateSelects(gate, file)))
}

/**
 * Assemble the complete report.
 * @param input - Changed files, the config source, the parsed gates, and an
 * optional error. When `error` is set, no gate list is produced and every
 * changed file is reported as unmatched instead of being dropped.
 * @returns The report, always with `enforcement: "none"`.
 */
export function buildGateReport(input: {
  changedFiles: readonly string[]
  source: string
  gates?: readonly GateDefinition[] | undefined
  error?: string | null | undefined
  code?: GateFailureCode | null | undefined
}): GateReport {
  const changedFiles = normalizeChangedFiles(input.changedFiles)
  const error = input.error ?? null
  if (error !== null) {
    return {
      changedFiles,
      requiredGates: [],
      source: input.source,
      enforcement: 'none',
      unmatched: [...changedFiles],
      error,
      code: input.code ?? 'config_invalid',
    }
  }
  const gates = input.gates ?? []
  return {
    changedFiles,
    requiredGates: selectRequiredGates(changedFiles, gates),
    source: input.source,
    enforcement: 'none',
    unmatched: selectUnmatchedFiles(changedFiles, gates),
    error: null,
    code: null,
  }
}

/**
 * Readable explanation for a config file that could not be found.
 * @param searched - Directory the upward search started from.
 * @returns One sentence naming the file and the search start.
 */
export function gateConfigNotFoundMessage(searched: string): string {
  return `No gate config found: no ${GATE_CONFIG_FILE_NAME} in ${searched} or any parent directory.`
}

/** Re-exported so callers of the core do not have to reach into `shared`. */
export { GATE_CONFIG_FILE_NAME, GATE_CONFIG_NOT_FOUND }
