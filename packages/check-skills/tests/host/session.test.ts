/**
 * Session-reader tests.
 *
 * The zstd cases build their fixtures with `zstdCompressSync` at run time rather
 * than committing a binary artifact, and the multi-frame case is the one that
 * matters most: a one-shot `zstdDecompressSync` call returns only the first
 * frame, which on a real artifact is the session header and nothing else.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as zlib from 'node:zlib'

import {
  SessionReadError,
  decompressZstdFrames,
  defaultSessionsDir,
  parseSessionLog,
  readSessionLog,
  resolveSessionPath,
} from '../../src/host/session.ts'
import { DEFAULT_CATALOG, catalogEvent, headerEvent, toLogText } from '../fixtures/session-log.ts'

const zstdAvailable = typeof zlib.zstdCompressSync === 'function'

/** Directories created by the current test, removed afterwards. */
const created: string[] = []

/** Make a throwaway directory that is cleaned up at the end of the test. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-skills-session-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('decompressZstdFrames', () => {
  it.skipIf(!zstdAvailable)('decodes a single frame', () => {
    const original = Buffer.from('{"type":"session"}\n', 'utf8')
    const result = decompressZstdFrames(zlib.zstdCompressSync(original))

    expect(result.text).toBe('{"type":"session"}\n')
    expect(result.frameCount).toBe(1)
    expect(result.truncatedTail).toBe(false)
  })

  it.skipIf(!zstdAvailable)('concatenates every frame, not just the first', () => {
    // This is the shape a real artifact has: the writer appends one frame per
    // durable batch, so `zstdDecompressSync` on the whole buffer sees only the
    // header and silently drops the rest.
    const frames = [
      '{"type":"session","seq":0}\n',
      '{"type":"tool/call","seq":1}\n',
      '{"type":"tool/result","seq":2}\n',
    ]
    const buffer = Buffer.concat(frames.map((frame) => zlib.zstdCompressSync(Buffer.from(frame, 'utf8'))))
    const result = decompressZstdFrames(buffer)

    expect(result.frameCount).toBe(frames.length)
    expect(result.text).toBe(frames.join(''))
  })

  it.skipIf(!zstdAvailable)('keeps the readable prefix when the tail is torn', () => {
    const complete = Buffer.from('{"type":"session"}\n', 'utf8')
    // Magic bytes only: no decoder can turn this into a complete frame, so the
    // assertion below does not depend on how lenient a given Node build is.
    const partial = zlib.zstdCompressSync(Buffer.from('{"type":"tool/call"}\n', 'utf8')).subarray(0, 4)
    const result = decompressZstdFrames(Buffer.concat([zlib.zstdCompressSync(complete), partial]))

    // The invariant this package owns: a torn tail must never corrupt or extend
    // the readable prefix. How the decoder reports the torn frame (a throw, an
    // empty string, a flagged drop) varies by Node build, so only the text and
    // the fact that at least one frame decoded are asserted here.
    expect(result.text).toBe('{"type":"session"}\n')
    expect(result.frameCount).toBeGreaterThanOrEqual(1)
  })

  it.skipIf(!zstdAvailable)('never reports a usable log for a frame that decodes to nothing', () => {
    // Node builds differ in how strictly the zstd decoder rejects a malformed
    // frame: some throw, some return junk. The contract this package owns is
    // that neither outcome may look like a readable session log.
    const garbage = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.alloc(24, 0x00)])

    let decoded: { text: string; frameCount: number } | undefined
    try {
      decoded = decompressZstdFrames(garbage)
    } catch {
      decoded = undefined
    }

    if (decoded !== undefined) {
      expect(decoded.text).not.toContain('"type"')
      expect(decoded.frameCount).toBeLessThanOrEqual(1)
    }
  })
})

describe('zstd capability probe', () => {
  // A static `import { zstdDecompressSync } from 'node:zlib'` is a module
  // *instantiation* error on a Node build whose zlib lacks that export: the
  // plugin never finishes loading, so the typed `zstd_unsupported` answer can
  // never be produced. The reader must therefore reach the decoder through the
  // module namespace and admit the absence at call time.
  it('never imports zstd through a static named import', () => {
    const source = readFileSync(new URL('../../src/host/session.ts', import.meta.url), 'utf8')

    // Anchored at line start so the prose in the file's own doc comment — which
    // quotes the shape being warned against — cannot satisfy or trip the check.
    expect(source).not.toMatch(/^\s*import\s*\{[^}]*zstd\b[^}]*\}\s*from/m)
    expect(source).toMatch(/^import \* as zlib from 'node:zlib'$/m)
  })

  it('probes the decoder off the namespace, where absence is a value not a crash', () => {
    // The probe must yield a value (function or undefined) rather than throwing,
    // which is what lets the reader answer `zstd_unsupported` instead of dying.
    const probe = (zlib as { zstdDecompressSync?: unknown }).zstdDecompressSync

    expect(['function', 'undefined']).toContain(typeof probe)
    expect(typeof probe).toBe(zstdAvailable ? 'function' : 'undefined')
  })
})

describe('parseSessionLog', () => {
  it('parses one record per line', () => {
    const text = toLogText([headerEvent(), catalogEvent()])
    const { events, malformedLineCount } = parseSessionLog(text)

    expect(events).toHaveLength(2)
    expect(events[0]?.type).toBe('session')
    expect(malformedLineCount).toBe(0)
  })

  it('parses records concatenated without newlines', () => {
    const text = toLogText([headerEvent(), catalogEvent(), catalogEvent(DEFAULT_CATALOG, 3, true)], true)
    const { events, malformedLineCount } = parseSessionLog(text)

    expect(events).toHaveLength(3)
    expect(malformedLineCount).toBe(0)
  })

  it('counts a torn row as malformed instead of repairing it', () => {
    const text = `${JSON.stringify(headerEvent())}\n{"type":"tool/ca\n`

    const { events, malformedLineCount } = parseSessionLog(text)

    expect(events).toHaveLength(1)
    expect(malformedLineCount).toBe(1)
  })

  it('counts a valid JSON row that is not an event as malformed', () => {
    const text = `${JSON.stringify(headerEvent())}\n[1,2,3]\n"a string"\n`

    const { events, malformedLineCount } = parseSessionLog(text)

    expect(events).toHaveLength(1)
    expect(malformedLineCount).toBe(2)
  })

  it('ignores blank lines', () => {
    const text = `\n\n${JSON.stringify(headerEvent())}\n\n`

    expect(parseSessionLog(text).events).toHaveLength(1)
    expect(parseSessionLog(text).malformedLineCount).toBe(0)
  })
})

describe('readSessionLog', () => {
  it('reads a plaintext artifact', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, toLogText([headerEvent()]))

    const analysis = readSessionLog(path)

    expect(analysis.events).toHaveLength(1)
    expect(analysis.frameCount).toBe(0)
    expect(analysis.sessionPath).toBe(path)
  })

  it.skipIf(!zstdAvailable)('reads every frame of a compressed artifact', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.v3.jsonl.zstd')
    const rows = [headerEvent(), catalogEvent(), catalogEvent(DEFAULT_CATALOG, 3, true)]
    writeFileSync(path, Buffer.concat(rows.map(
      (row) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(row)}\n`, 'utf8')),
    )))

    const analysis = readSessionLog(path)

    expect(analysis.events).toHaveLength(3)
    expect(analysis.frameCount).toBe(3)
  })

  it.skipIf(!zstdAvailable)('trusts the frame magic over a misleading name', () => {
    // A `.jsonl`-named artifact that is actually compressed would decode to
    // mojibake as UTF-8, so the bytes decide.
    const dir = scratchDir()
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, zlib.zstdCompressSync(Buffer.from(toLogText([headerEvent()]), 'utf8')))

    expect(readSessionLog(path).events).toHaveLength(1)
  })

  it('reports an empty file as session_empty', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, '')

    try {
      readSessionLog(path)
      expect.unreachable('an empty artifact must not produce an analysis')
    } catch (error) {
      expect(error).toBeInstanceOf(SessionReadError)
      expect((error as SessionReadError).code).toBe('session_empty')
    }
  })

  it('reports undecodable bytes as session_decompress_failed', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.v3.jsonl.zstd')
    writeFileSync(path, Buffer.alloc(64, 0x7a))

    try {
      readSessionLog(path)
      expect.unreachable('garbage must not produce an analysis')
    } catch (error) {
      expect((error as SessionReadError).code).toBe('session_decompress_failed')
    }
  })

  it('reports a missing file as session_unreadable', () => {
    const dir = scratchDir()

    try {
      readSessionLog(join(dir, 'does-not-exist.jsonl'))
      expect.unreachable('a missing artifact must not produce an analysis')
    } catch (error) {
      expect((error as SessionReadError).code).toBe('session_unreadable')
    }
  })
})

describe('resolveSessionPath', () => {
  it('accepts an explicit file path verbatim', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, toLogText([headerEvent()]))

    expect(resolveSessionPath(path)).toBe(path)
  })

  it('reports a missing explicit path as session_not_found', () => {
    const dir = scratchDir()

    try {
      resolveSessionPath(join(dir, 'nope.jsonl'))
      expect.unreachable('a missing path must not resolve')
    } catch (error) {
      expect((error as SessionReadError).code).toBe('session_not_found')
    }
  })

  it('finds the artifact inside an explicitly given session directory', () => {
    const dir = scratchDir()
    const path = join(dir, 'session.v3.jsonl.zstd')
    writeFileSync(path, toLogText([headerEvent()]))

    expect(resolveSessionPath(dir)).toBe(path)
  })

  it('picks the newest artifact under the session root', () => {
    const home = scratchDir()
    const root = join(home, 'sessions')
    const older = join(root, '--project-a--', 'session-1')
    const newer = join(root, '--project-b--', 'session-2')
    mkdirSync(older, { recursive: true })
    mkdirSync(newer, { recursive: true })
    writeFileSync(join(older, 'session.v3.jsonl.zstd'), toLogText([headerEvent('session-1')]))
    writeFileSync(join(newer, 'session.v3.jsonl.zstd'), toLogText([headerEvent('session-2')]))
    // Set the timestamps explicitly: two writes inside the same filesystem
    // timestamp tick would otherwise make "the newest" a coin flip on CI.
    const older_artifact = join(older, 'session.v3.jsonl.zstd')
    const newer_artifact = join(newer, 'session.v3.jsonl.zstd')
    utimesSync(older_artifact, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    utimesSync(newer_artifact, new Date(), new Date())
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      expect(resolveSessionPath()).toBe(join(newer, 'session.v3.jsonl.zstd'))
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('reports an empty session root as sessions_dir_empty', () => {
    const home = scratchDir()
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = home
    try {
      resolveSessionPath()
      expect.unreachable('an empty root must not resolve')
    } catch (error) {
      expect((error as SessionReadError).code).toBe('sessions_dir_empty')
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('reports an absent session root as sessions_dir_missing', () => {
    const home = scratchDir()
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = join(home, 'not-created')
    try {
      resolveSessionPath()
      expect.unreachable('an absent root must not resolve')
    } catch (error) {
      expect((error as SessionReadError).code).toBe('sessions_dir_missing')
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })
})

describe('defaultSessionsDir', () => {
  it('honours DSH_HOME', () => {
    const previous = process.env['DSH_HOME']
    process.env['DSH_HOME'] = '/tmp/some-dsh-home'
    try {
      expect(defaultSessionsDir()).toBe('/tmp/some-dsh-home/sessions')
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('falls back to ~/.dsh without DSH_HOME', () => {
    const previous = process.env['DSH_HOME']
    delete process.env['DSH_HOME']
    try {
      expect(defaultSessionsDir().endsWith(join('.dsh', 'sessions'))).toBe(true)
    } finally {
      if (previous !== undefined) process.env['DSH_HOME'] = previous
    }
  })
})
