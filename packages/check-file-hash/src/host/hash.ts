/* oxlint-disable no-await-in-loop -- The walk, the stat and the hash run strictly one step at a
   time on purpose: a deterministic first-failure path, a bounded number of open files and a
   report that does not depend on scheduling order are worth more here than parallelism. */
/**
 * Hashing core: resolve the caller's paths, hash every regular file with sha256,
 * and assemble one report.
 *
 * Why hash the bytes instead of trusting a claim: a receipt can name a file, a
 * size and a version and still describe content that is not on disk. A digest
 * computed from the file itself is the only part of the record that cannot be
 * asserted without reading it.
 *
 * The core never returns a partial file list: a path that cannot be resolved,
 * opened or read aborts the call with a typed failure naming that path, because a
 * short list would look complete. The one thing that never aborts a check is a
 * failed evidence write — see `./evidence.ts`.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type {
  CollectOutcome,
  FileHash,
  HashFailure,
  HashFailureCode,
  HashOneOutcome,
  HashOptions,
  HashOutcome,
} from '../shared/types.ts'

/** The one digest this package speaks. */
export const HASH_ALGO = 'sha256'

/** Node's `code` property, when the thrown value carries one. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code: unknown = error.code
  return typeof code === 'string' ? code : undefined
}

/** Readable description of a thrown value. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build a typed failure without a partial file list. */
function failure(code: HashFailureCode, message: string, path?: string): HashFailure {
  return { status: 'error', code, message, ...(path === undefined ? {} : { path }) }
}

/**
 * Hash one regular file.
 *
 * `not_found` and `unreadable` are separated on purpose: a path that does not
 * exist is a caller mistake, while a path that exists and cannot be read is an
 * environment problem, and the two need different follow-up.
 * @param target - File to hash; resolved against the working directory.
 * @param options - Cancellation forwarded from the tool call.
 * @returns The digest and byte size, or a typed failure naming why it is absent.
 */
export async function hashOneFile(target: string, options: HashOptions = {}): Promise<HashOneOutcome> {
  const { signal } = options
  signal?.throwIfAborted()

  const path = resolve(target)

  let size: number
  try {
    const stats = await stat(path)
    if (!stats.isFile()) {
      return failure('not_a_file', `not a regular file: ${path}`, path)
    }
    size = stats.size
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return failure('not_found', `no such file or directory: ${path}`, path)
    }
    return failure('unreadable', `could not inspect ${path}: ${describeError(error)}`, path)
  }

  const digest = createHash(HASH_ALGO)
  try {
    // Streamed, never buffered: an artifact is allowed to be larger than memory.
    // The signal reaches the stream, so an aborted call destroys the read instead
    // of hashing the rest of a large file.
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk)
  } catch (error) {
    signal?.throwIfAborted()
    return failure('unreadable', `could not read ${path}: ${describeError(error)}`, path)
  }

  return { status: 'ok', file: { path, algo: HASH_ALGO, hash: digest.digest('hex'), size } }
}

/**
 * List the regular files one directory holds, recursively.
 *
 * A symlinked file is included and hashed through its target; a symlinked
 * directory is not followed, because a cycle has no finite walk. Broken links,
 * sockets, FIFOs and devices are skipped: they have no finite bytes to hash, and
 * a directory listing is not the place to fail a check over them. An explicit
 * caller path is stricter — see {@link collectFiles}.
 * @param dir - Directory to walk.
 * @param out - Accumulator the found file paths are appended to.
 * @param signal - Cancellation forwarded from the tool call.
 * @returns A typed failure when a subdirectory cannot be listed, else undefined.
 */
async function collectDirectory(
  dir: string,
  out: string[],
  signal: AbortSignal | undefined,
): Promise<HashFailure | undefined> {
  signal?.throwIfAborted()

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    signal?.throwIfAborted()
    return failure('unreadable', `could not list ${dir}: ${describeError(error)}`, dir)
  }

  for (const entry of entries) {
    signal?.throwIfAborted()
    const child = join(dir, entry.name)
    if (entry.isDirectory()) {
      const problem = await collectDirectory(child, out, signal)
      if (problem !== undefined) return problem
      continue
    }
    if (entry.isFile()) {
      out.push(child)
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = await stat(child).catch(() => undefined)
      if (target?.isFile() === true) out.push(child)
    }
  }

  return undefined
}

/**
 * Resolve caller paths into the regular files they select.
 *
 * Directories are walked recursively; an explicitly passed path that is neither
 * a regular file nor a directory is `not_a_file`; a path that does not exist is
 * `not_found`. The result is de-duplicated and sorted by absolute path, so two
 * runs over the same selection are comparable line by line.
 * @param paths - Files or directories to select from.
 * @param options - Cancellation forwarded from the tool call.
 * @returns Sorted absolute file paths, or a typed failure naming the first bad path.
 */
export async function collectFiles(
  paths: readonly string[],
  options: HashOptions = {},
): Promise<CollectOutcome> {
  const { signal } = options
  const found: string[] = []

  for (const target of paths) {
    signal?.throwIfAborted()
    const path = resolve(target)

    let stats
    try {
      stats = await stat(path)
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return failure('not_found', `no such file or directory: ${path}`, path)
      }
      return failure('unreadable', `could not inspect ${path}: ${describeError(error)}`, path)
    }

    if (stats.isDirectory()) {
      const problem = await collectDirectory(path, found, signal)
      if (problem !== undefined) return problem
      continue
    }
    if (!stats.isFile()) {
      return failure('not_a_file', `not a regular file: ${path}`, path)
    }
    found.push(path)
  }

  return { status: 'ok', files: [...new Set(found)].toSorted() }
}

/**
 * Hash every file the caller's paths select and assemble the report.
 *
 * Files are hashed one at a time in path order. A failure stops the walk at the
 * first offending file and names it, so a caller never has to guess which part of
 * the selection a short list covers.
 * @param paths - Files or directories to hash.
 * @param options - Cancellation forwarded from the tool call.
 * @returns The report, or a typed failure that carries no file list.
 */
export async function checkFileHash(
  paths: readonly string[],
  options: HashOptions = {},
): Promise<HashOutcome> {
  const { signal } = options

  const collected = await collectFiles(paths, options)
  if (collected.status === 'error') return collected

  const files: FileHash[] = []
  for (const path of collected.files) {
    signal?.throwIfAborted()
    const hashed = await hashOneFile(path, options)
    if (hashed.status === 'error') return hashed
    files.push(hashed.file)
  }

  return {
    status: 'ok',
    files,
    generatedAt: new Date().toISOString(),
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  }
}
