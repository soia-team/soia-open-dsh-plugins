/**
 * Session-log reader: locate, decompress and parse the JSONL artifact DSH
 * persists a session into.
 *
 * Two physical facts drive this module, both established by reading real logs
 * under `$DSH_HOME/sessions` rather than by assumption:
 *
 * 1. The artifact is a **concatenated-frame** Zstandard container, not a single
 *    frame: the writer appends one independently decodable frame per durable
 *    batch. `node:zlib`'s one-shot `zstdDecompressSync` returns only the first
 *    frame, so reading it alone silently yields just the session header. The
 *    frames are therefore located structurally and decoded one by one.
 * 2. Generation `v0` wrote one JSON record per line; later generations append
 *    records without a separating newline. A line-oriented parse would fuse a
 *    whole batch into one unparseable row, so the parser accepts both.
 *
 * The reader never guesses: an unreadable, empty or undecodable artifact comes
 * back as a typed code, and rows that fail to parse are counted and dropped
 * rather than repaired.
 */
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'

import type { CheckSkillsFailureCode, SessionAnalysis, SessionEvent } from '../shared/types.ts'

/**
 * Zstandard decoder, resolved by capability probe rather than by a static named
 * import.
 *
 * A static `import { zstdDecompressSync } from 'node:zlib'` is a **module
 * instantiation** error on a Node build whose zlib has no such export: the whole
 * plugin fails to load with `SyntaxError: The requested module 'node:zlib' does
 * not provide an export named ...`, and the typed `zstd_unsupported` answer this
 * package promises can never be produced, because the module never finishes
 * evaluating. Reading it off the namespace keeps the failure at call time, where
 * it becomes a readable code.
 */
const zstdDecompressSync: ((input: Buffer) => Buffer) | undefined =
  (zlib as { zstdDecompressSync?: (input: Buffer) => Buffer }).zstdDecompressSync

/** Default session root, used when `$DSH_HOME` is absent. */
const DEFAULT_DSH_HOME_SEGMENTS = ['.dsh'] as const

/** Bytes of a file read when only its shape is being inspected. */
const PEEK_BYTES = 4

/** Zstandard frame magic number, little-endian on disk: `28 B5 2F FD`. */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const

/** Candidate artifact names, most current generation first. */
const ARTIFACT_SUFFIXES = ['.jsonl.zstd', '.jsonl'] as const

/**
 * Typed reader failure. Carries the code the tool reports, so the caller never
 * has to translate a message string into a decision.
 */
export class SessionReadError extends Error {
  readonly code: CheckSkillsFailureCode

  readonly sessionPath: string | undefined

  constructor(code: CheckSkillsFailureCode, message: string, sessionPath?: string) {
    super(message)
    this.name = 'SessionReadError'
    this.code = code
    this.sessionPath = sessionPath
  }
}

/**
 * `$DSH_HOME`, or `~/.dsh` when the host did not set it.
 * @returns Absolute session root directory.
 */
export function defaultSessionsDir(): string {
  const home = process.env['DSH_HOME']
  if (home !== undefined && home !== '') return join(home, 'sessions')
  return join(homedir(), ...DEFAULT_DSH_HOME_SEGMENTS, 'sessions')
}

/**
 * Find the first occurrence of the Zstandard frame magic at or after `from`.
 * @param buffer - bytes to scan.
 * @param from - inclusive index to start at.
 * @returns Index of the magic, or -1 when absent.
 */
function findFrameMagic(buffer: Buffer, from: number): number {
  const last = buffer.length - ZSTD_MAGIC.length
  for (let index = Math.max(from, 0); index <= last; index += 1) {
    if (buffer[index] !== ZSTD_MAGIC[0]) continue
    if (buffer[index + 1] !== ZSTD_MAGIC[1]) continue
    if (buffer[index + 2] !== ZSTD_MAGIC[2]) continue
    if (buffer[index + 3] !== ZSTD_MAGIC[3]) continue
    return index
  }
  return -1
}

/** What one decompression pass produced. */
interface DecompressedLog {
  text: string
  frameCount: number
  truncatedTail: boolean
}

/**
 * Decode a concatenated-frame Zstandard buffer.
 *
 * Frames are located by magic scan and each is handed to the one-shot decoder,
 * because the one-shot API consumes only the leading frame and reports nothing
 * about the bytes it left behind. A frame that fails to decode is treated as a
 * torn tail: its bytes stay undecoded and the text accumulated so far is
 * returned, which is what the writer leaves behind after an interrupted append.
 *
 * @param buffer - raw artifact bytes.
 * @returns Plaintext plus how many frames decoded and whether a tail was dropped.
 * @throws SessionReadError `zstd_unsupported` when this Node build has no zstd
 * decoder, or Error when no frame decodes at all.
 */
export function decompressZstdFrames(buffer: Buffer): DecompressedLog {
  // The guard lives here rather than only in the suffix-based wrapper, so this
  // exported entry point is safe to call on its own.
  const decode = zstdDecompressSync
  if (decode === undefined) throw unsupportedError()

  const starts: number[] = []
  let cursor = findFrameMagic(buffer, 0)
  while (cursor !== -1) {
    starts.push(cursor)
    cursor = findFrameMagic(buffer, cursor + ZSTD_MAGIC.length)
  }
  if (starts.length === 0) {
    // No frame header: the artifact may still be a bare stream the decoder accepts.
    const text = decode(buffer).toString('utf8')
    return { text, frameCount: 1, truncatedTail: false }
  }

  const decoded: string[] = []
  let dropped = 0
  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? buffer.length
    try {
      decoded.push(decode(buffer.subarray(start, end)).toString('utf8'))
    } catch {
      dropped += 1
      break
    }
  }
  if (decoded.length === 0) throw new Error('no complete Zstandard frame decoded')
  return { text: decoded.join(''), frameCount: decoded.length, truncatedTail: dropped > 0 }
}

/** The typed answer for a Node build with no zstd decoder. */
function unsupportedError(): SessionReadError {
  return new SessionReadError(
    'zstd_unsupported',
    'this Node build has no zlib.zstdDecompressSync; Node >= 22.15 is required to read .jsonl.zstd artifacts',
  )
}

/**
 * Decompress an artifact by its suffix.
 * @param buffer - raw bytes.
 * @param suffix - artifact suffix the bytes came from.
 * @returns Plaintext plus frame accounting.
 * @throws SessionReadError `zstd_unsupported`, or Error when decoding fails.
 */
function decompress(buffer: Buffer, suffix: string): DecompressedLog {
  if (suffix === '.jsonl') return { text: buffer.toString('utf8'), frameCount: 0, truncatedTail: false }
  if (typeof zstdDecompressSync !== 'function') throw unsupportedError()
  return decompressZstdFrames(buffer)
}

/**
 * Read up to `PEEK_BYTES` from an open descriptor without disturbing position.
 * @param fd - Open file descriptor.
 * @returns The bytes actually read, which may be shorter than requested.
 */
function peek(fd: number): Buffer {
  const head = Buffer.alloc(PEEK_BYTES)
  const read = readSync(fd, head, 0, PEEK_BYTES, 0)
  return head.subarray(0, read)
}

/**
 * True when the first bytes of `path` are a Zstandard frame, read from a file
 * descriptor so no second full read is needed to decide how to decode.
 * @param path - Candidate artifact path.
 * @returns Whether the bytes start with the frame magic.
 */
function startsWithZstdMagic(path: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    return findFrameMagic(peek(fd), 0) === 0
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Resolve a session artifact path that actually exists.
 *
 * A caller-supplied path is taken literally. The default resolves the newest
 * artifact under `$DSH_HOME/sessions`, searched to a bounded depth because the
 * layout is `<cwd-key>/<session-id>/session*.jsonl*`.
 *
 * @param explicit - Caller-supplied path, or undefined to pick the newest.
 * @returns Absolute path of an existing artifact.
 * @throws SessionReadError with a typed code when nothing is resolvable.
 */
export function resolveSessionPath(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    const path = explicit.trim()
    let stats
    try {
      stats = statSync(path)
    } catch {
      throw new SessionReadError('session_not_found', `no session artifact at ${path}`, path)
    }
    if (stats.isFile()) return path
    // A directory is accepted as a convenience: look for the artifact inside it.
    const inDirectory = findNewestArtifact(path, 1)
    if (inDirectory === undefined) {
      throw new SessionReadError('session_not_found', `no session artifact inside ${path}`, path)
    }
    return inDirectory
  }

  const root = defaultSessionsDir()
  try {
    if (!statSync(root).isDirectory()) {
      throw new SessionReadError('sessions_dir_missing', `session root is not a directory: ${root}`, root)
    }
  } catch (error) {
    if (error instanceof SessionReadError) throw error
    throw new SessionReadError('sessions_dir_missing', `no session root at ${root}`, root)
  }

  const newest = findNewestArtifact(root, 4)
  if (newest === undefined) {
    throw new SessionReadError('sessions_dir_empty', `no session artifact under ${root}`, root)
  }
  return newest
}

/**
 * Newest session artifact at or below `dir`.
 * @param dir - Directory to search.
 * @param depth - Remaining directory levels to descend.
 * @returns Path of the newest artifact, or undefined when there is none.
 */
function findNewestArtifact(dir: string, depth: number): string | undefined {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return undefined
  }

  let best: { path: string, mtimeMs: number } | undefined
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth <= 0) continue
      const nested = findNewestArtifact(path, depth - 1)
      if (nested === undefined) continue
      let nestedStats
      try {
        nestedStats = statSync(nested)
      } catch {
        continue
      }
      if (best === undefined || nestedStats.mtimeMs > best.mtimeMs) {
        best = { path: nested, mtimeMs: nestedStats.mtimeMs }
      }
      continue
    }
    const suffix = ARTIFACT_SUFFIXES.find((candidate) => entry.name.endsWith(candidate))
    if (suffix === undefined) continue
    if (!entry.name.startsWith('session')) continue
    let stats
    try {
      stats = statSync(path)
    } catch {
      continue
    }
    if (best === undefined || stats.mtimeMs > best.mtimeMs) best = { path, mtimeMs: stats.mtimeMs }
  }
  return best?.path
}

/**
 * Free JSON values on one line, in order.
 *
 * The log concatenates records without newlines in later generations, so a line
 * can carry several objects; `JSON.parse` accepts trailing bytes and reports in
 * its error how far it got, which is what advances the cursor here.
 *
 * @param line - One non-empty log line.
 * @returns Every complete JSON value found, plus what was left unconsumed.
 */
function parseConcatenatedJson(line: string): { values: unknown[], rest: string } {
  const values: unknown[] = []
  let rest = line.trim()
  while (rest !== '') {
    try {
      values.push(JSON.parse(rest))
      return { values, rest: '' }
    } catch (error) {
      const consumed = consumedLength(error)
      if (consumed === undefined || consumed >= rest.length) return { values, rest }
      try {
        values.push(JSON.parse(rest.slice(0, consumed)))
      } catch {
        return { values, rest }
      }
      rest = rest.slice(consumed).trim()
    }
  }
  return { values, rest }
}

/**
 * How many characters `JSON.parse` reports having consumed before it failed.
 *
 * V8 words the position as either "at position N" (offset of the offending
 * character) or "at line L column C"; both are handled, and an unrecognised
 * message yields undefined so the row is dropped instead of mis-sliced.
 *
 * @param error - The error thrown by `JSON.parse`.
 * @returns Character count consumed, or undefined when it cannot be told.
 */
function consumedLength(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : ''
  const position = /at position (\d+)/.exec(message)
  if (position?.[1] !== undefined) {
    const value = Number.parseInt(position[1], 10)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  const lineColumn = /at line (\d+) column (\d+)/.exec(message)
  if (lineColumn?.[1] !== undefined && lineColumn[2] !== undefined) {
    const line = Number.parseInt(lineColumn[1], 10)
    const column = Number.parseInt(lineColumn[2], 10)
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line !== 1) return undefined
    return column > 1 ? column - 1 : undefined
  }
  return undefined
}

/** True when a decoded JSON value looks like a session event row. */
function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return typeof (value as { type?: unknown }).type === 'string'
}

/**
 * Parse decoded log text into event rows.
 *
 * Every non-empty row is attempted. A row that is not valid JSON, or that JSON
 * but not an event object, is counted as malformed and dropped; it is never
 * reconstructed from neighbouring rows.
 *
 * @param text - Decoded log plaintext.
 * @returns The events in log order and the malformed-row count.
 */
export function parseSessionLog(text: string): { events: SessionEvent[], malformedLineCount: number } {
  const events: SessionEvent[] = []
  let malformedLineCount = 0
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const { values } = parseConcatenatedJson(line)
    if (values.length === 0) {
      malformedLineCount += 1
      continue
    }
    for (const value of values) {
      if (isSessionEvent(value)) events.push(value)
      else malformedLineCount += 1
    }
  }
  return { events, malformedLineCount }
}

/**
 * Read and decode one session artifact.
 * @param path - Absolute artifact path.
 * @returns Events, malformed-row count and frame accounting.
 * @throws SessionReadError with a typed code for every failure mode.
 */
export function readSessionLog(path: string): SessionAnalysis {
  let buffer: Buffer
  try {
    buffer = readFileSync(path)
  } catch (error) {
    throw new SessionReadError('session_unreadable', `could not read ${path}: ${String(error)}`, path)
  }
  if (buffer.length === 0) {
    throw new SessionReadError('session_empty', `session artifact is empty: ${path}`, path)
  }

  const namedSuffix = ARTIFACT_SUFFIXES.find((candidate) => path.endsWith(candidate)) ?? ''
  // Trust the bytes over the name: a `.jsonl`-named file that starts with the
  // frame magic is compressed, and decoding it as UTF-8 would yield mojibake.
  const compressed = namedSuffix === '.jsonl.zstd' || startsWithZstdMagic(path)
  let decoded: DecompressedLog
  try {
    decoded = decompress(buffer, compressed ? '.jsonl.zstd' : '.jsonl')
  } catch (error) {
    if (error instanceof SessionReadError) throw error
    throw new SessionReadError(
      'session_decompress_failed',
      `could not decompress ${path}: ${String(error)}`,
      path,
    )
  }

  const { events, malformedLineCount } = parseSessionLog(decoded.text)
  return {
    sessionPath: path,
    events,
    malformedLineCount,
    frameCount: decoded.frameCount,
    truncatedTail: decoded.truncatedTail,
  }
}

/**
 * Resolve and read in one step.
 * @param explicit - Caller-supplied artifact path, or undefined for the newest.
 * @returns The decoded session analysis.
 * @throws SessionReadError with a typed code.
 */
export function loadSession(explicit?: string): SessionAnalysis {
  const path = resolveSessionPath(explicit)
  return readSessionLog(path)
}
