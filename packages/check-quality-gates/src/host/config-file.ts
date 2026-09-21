/**
 * Config lookup half of the gate core: find the caller's config file, read it,
 * and turn any failure into a readable report instead of an exception.
 *
 * This is the only module in the package that touches the filesystem. The rules
 * it implements are deliberately small: an explicit `configPath` wins, otherwise
 * the search walks up from the working directory to the filesystem root looking
 * for `.dsh/gates.yml`.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { GATE_CONFIG_FILE_NAME, GATE_CONFIG_NOT_FOUND, type GateReport } from '../shared/types.ts'
import { GateConfigError, buildGateReport, gateConfigNotFoundMessage, parseGateConfig } from './gates.ts'

/** Whether one path exists and is a regular file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** One-sentence reason from an unknown thrown value. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Find the nearest config file at or above `startDir`.
 * @param startDir - Directory the search starts from.
 * @returns The absolute path, or undefined when no parent holds one.
 */
export function findGateConfigPath(startDir: string): string | undefined {
  let directory = resolve(startDir)
  for (;;) {
    const candidate = join(directory, GATE_CONFIG_FILE_NAME)
    if (isFile(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/**
 * Produce the report for one call. Never throws: a missing, unreadable, or
 * invalid config yields a readable `error` and an empty gate list, with every
 * changed file reported as unmatched.
 * @param input - Changed files, an optional explicit config path, and an
 * optional working directory (defaults to the host process's directory).
 * @returns The complete report.
 */
export function resolveGateReport(input: {
  changedFiles: readonly string[]
  configPath?: string | undefined
  cwd?: string | undefined
}): GateReport {
  const cwd = resolve(input.cwd ?? process.cwd())
  const explicit = input.configPath?.trim()
  const requested = explicit === undefined || explicit === '' ? undefined : resolve(cwd, explicit)
  const source = requested ?? findGateConfigPath(cwd)

  if (source === undefined) {
    return buildGateReport({
      changedFiles: input.changedFiles,
      source: GATE_CONFIG_NOT_FOUND,
      error: gateConfigNotFoundMessage(cwd),
    })
  }
  if (!isFile(source)) {
    return buildGateReport({
      changedFiles: input.changedFiles,
      source: GATE_CONFIG_NOT_FOUND,
      error: `No gate config found at ${source}.`,
    })
  }

  let text: string
  try {
    text = readFileSync(source, 'utf8')
  } catch (error) {
    return buildGateReport({
      changedFiles: input.changedFiles,
      source,
      error: `Could not read gate config at ${source}: ${reason(error)}.`,
    })
  }

  try {
    return buildGateReport({ changedFiles: input.changedFiles, source, gates: parseGateConfig(text) })
  } catch (error) {
    const detail = error instanceof GateConfigError ? error.message : reason(error)
    return buildGateReport({
      changedFiles: input.changedFiles,
      source,
      error: `Invalid gate config at ${source}: ${detail}.`,
    })
  }
}
