/**
 * Evidence writer: one JSON record per check, written atomically with owner-only
 * permissions.
 *
 * The record exists so the digest can be re-checked later without re-running the
 * tool: the file holds exactly the value the tool returned. It holds paths,
 * digests and sizes — never file content, never base64, never a binary excerpt.
 *
 * The write path follows the host's atomic-write posture: a random-suffix sibling
 * created exclusively, then a `rename` onto the final name. A reader therefore
 * sees either no file or the complete record, the temporary file never survives a
 * successful write, and the caller-stated mode travels with the fresh inode. It is
 * implemented here instead of borrowing the host's primitive so this package
 * depends on nothing but Node builtins at runtime; like that primitive it does not
 * `fsync`, so it promises atomicity, not crash durability.
 */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { EvidenceError, HashSuccess } from '../shared/types.ts'

/** Permissions of an evidence directory this package creates. */
export const EVIDENCE_DIR_MODE = 0o700

/** Permissions of an evidence file. */
export const EVIDENCE_FILE_MODE = 0o600

/** The one code this module reports. */
const WRITE_FAILED = 'evidence_write_failed' as const

/** Build the typed write failure. */
function writeFailure(message: string): EvidenceError {
  return { code: WRITE_FAILED, message }
}

/** Readable description of a thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Node's `code` property, when the thrown value carries one. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code: unknown = error.code
  return typeof code === 'string' ? code : undefined
}

/**
 * File name of one record: `hash-<ISO timestamp>.json`.
 *
 * Every `:` is replaced with `-`, so the same name is legal on Windows, macOS and
 * Linux. The timestamp is the report's `generatedAt`, which is why the name is
 * derived from the value rather than from a second clock reading.
 * @param generatedAt - The report's ISO 8601 timestamp.
 * @returns The file name, without a directory.
 */
export function evidenceFileName(generatedAt: string): string {
  return `hash-${generatedAt.replaceAll(':', '-')}.json`
}

/**
 * Absolute path of the record for one report.
 * @param evidenceDir - Directory the caller asked for.
 * @param generatedAt - The report's ISO 8601 timestamp.
 * @returns The absolute evidence file path.
 */
export function evidenceFilePath(evidenceDir: string, generatedAt: string): string {
  return join(resolve(evidenceDir), evidenceFileName(generatedAt))
}

/**
 * Make sure the caller's evidence directory exists.
 *
 * A directory this package creates is `0700`. A directory that already existed is
 * used as it is and never re-chmoded: the caller may have pointed at a shared
 * location on purpose, and narrowing the permissions of someone else's directory
 * is not this package's decision to make.
 * @param dir - Directory the caller asked for.
 * @returns A typed failure when the path is not a usable directory, else undefined.
 */
async function ensureEvidenceDir(dir: string): Promise<EvidenceError | undefined> {
  const path = resolve(dir)

  try {
    const stats = await stat(path)
    if (!stats.isDirectory()) return writeFailure(`not a directory: ${path}`)
    return undefined
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      return writeFailure(`could not inspect ${path}: ${describeError(error)}`)
    }
  }

  try {
    await mkdir(path, { recursive: true, mode: EVIDENCE_DIR_MODE })
    // `mkdir` mode is masked by the umask; the record's directory is owner-only
    // by contract, so the bits are stated again on the fresh inode.
    await chmod(path, EVIDENCE_DIR_MODE)
  } catch (error) {
    return writeFailure(`could not create ${path}: ${describeError(error)}`)
  }

  return undefined
}

/**
 * Write one record atomically.
 *
 * The temporary file is an exclusively created sibling, so a symlink planted at a
 * guessable temporary path cannot redirect the write, and it carries the final
 * mode through the rename. Any failure removes the temporary file and leaves an
 * existing record untouched.
 * @param path - Final absolute path of the record.
 * @param text - Complete file content.
 * @returns A typed failure when nothing was replaced, else undefined.
 */
export async function writeEvidenceFile(path: string, text: string): Promise<EvidenceError | undefined> {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`

  try {
    const handle = await open(temporary, 'wx', EVIDENCE_FILE_MODE)
    try {
      await handle.chmod(EVIDENCE_FILE_MODE)
      await handle.writeFile(text, 'utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    await rm(temporary, { force: true })
    return writeFailure(`could not write ${path}: ${describeError(error)}`)
  }

  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    return writeFailure(`could not replace ${path}: ${describeError(error)}`)
  }

  return undefined
}

/**
 * Attach the written record to a finished report.
 *
 * The file content is the JSON of the returned value, `evidencePath` included, so
 * the record and the tool result can be compared field by field. When the write
 * fails the report is returned unchanged apart from `evidenceError`: losing the
 * record must not lose the measurements.
 * @param result - Successful report from the hashing core.
 * @param evidenceDir - Directory the caller asked for.
 * @returns The report with `evidencePath`, or with `evidenceError` when it could not be written.
 */
export async function attachEvidence(result: HashSuccess, evidenceDir: string): Promise<HashSuccess> {
  const path = evidenceFilePath(evidenceDir, result.generatedAt)

  const directoryProblem = await ensureEvidenceDir(evidenceDir)
  if (directoryProblem !== undefined) return { ...result, evidenceError: directoryProblem }

  const recorded: HashSuccess = { ...result, evidencePath: path }
  const writeProblem = await writeEvidenceFile(path, `${JSON.stringify(recorded, null, 2)}\n`)
  if (writeProblem !== undefined) return { ...result, evidenceError: writeProblem }

  return recorded
}
