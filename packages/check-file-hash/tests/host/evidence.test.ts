/**
 * Evidence-writer tests.
 *
 * The assertions that matter here are the ones a receipt depends on: the record's
 * name, its permissions, the absence of a leftover temporary file, and the absence
 * of file content in a file that is meant to be quotable.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { attachEvidence, EVIDENCE_DIR_MODE, EVIDENCE_FILE_MODE, evidenceFileName } from '../../src/host/evidence.ts'
import { checkFileHash } from '../../src/host/hash.ts'
import type { HashSuccess } from '../../src/shared/types.ts'

/** Bytes that must never reappear in an evidence record. */
const CONTENT_MARKER = 'TOP-SECRET-CONTENT-MARKER'

/** The name shape the contract fixes: `hash-<ISO timestamp>.json`, `:` replaced. */
const EVIDENCE_NAME = /^hash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'check-file-hash-evidence-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Hash one fixture file so the writer has a real report to record. */
async function report(content = CONTENT_MARKER): Promise<HashSuccess> {
  const path = join(root, 'artifact.bin')
  await writeFile(path, content)

  const result = await checkFileHash([path])

  expect(result.status).toBe('ok')
  if (result.status !== 'ok') throw new Error('fixture could not be hashed')
  return result
}

/** Permission bits of one path, without the file-type bits. */
async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

describe('evidenceFileName', () => {
  it('replaces every colon so the name stays legal off POSIX', () => {
    const name = evidenceFileName('2026-09-21T07:14:03.812Z')

    expect(name).toBe('hash-2026-09-21T07-14-03.812Z.json')
    expect(name).not.toContain(':')
  })
})

describe('attachEvidence', () => {
  it('writes one record under the requested directory and returns its path', async () => {
    const evidenceDir = join(root, 'evidence')
    const result = await report()

    const withEvidence = await attachEvidence(result, evidenceDir)

    expect(withEvidence.evidenceError).toBeUndefined()
    expect(withEvidence.evidencePath).toBe(join(evidenceDir, evidenceFileName(result.generatedAt)))
    expect(basename(withEvidence.evidencePath ?? '')).toMatch(EVIDENCE_NAME)
    await expect(readFile(withEvidence.evidencePath ?? '', 'utf8')).resolves.toContain('"sha256"')
  })

  it('creates the directory 0700 and the record 0600', async () => {
    const evidenceDir = join(root, 'nested/evidence')
    const result = await report()

    const withEvidence = await attachEvidence(result, evidenceDir)

    expect(await modeOf(evidenceDir)).toBe(EVIDENCE_DIR_MODE)
    expect(await modeOf(withEvidence.evidencePath ?? '')).toBe(EVIDENCE_FILE_MODE)
  })

  it('leaves no temporary file behind and replaces an existing record atomically', async () => {
    const evidenceDir = join(root, 'evidence')
    const first = await report('first')
    const written = await attachEvidence(first, evidenceDir)

    // A second write of the same timestamped name must replace the file, not
    // append to it or leave the intermediate sibling behind.
    const second = await attachEvidence({ ...first, totalBytes: 0 }, evidenceDir)

    expect(await readdir(evidenceDir)).toEqual([evidenceFileName(first.generatedAt)])
    expect(written.evidencePath).toBe(second.evidencePath)
    const content = JSON.parse(await readFile(second.evidencePath ?? '', 'utf8')) as HashSuccess
    expect(content.totalBytes).toBe(0)
  })

  it('records exactly the returned value and never the hashed bytes', async () => {
    const evidenceDir = join(root, 'evidence')
    const result = await report()

    const withEvidence = await attachEvidence(result, evidenceDir)
    const text = await readFile(withEvidence.evidencePath ?? '', 'utf8')
    const recorded = JSON.parse(text) as HashSuccess

    expect(recorded).toEqual(withEvidence)
    expect(text).not.toContain(CONTENT_MARKER)
    // The record's own schema has no field a file body could travel in.
    expect(Object.keys(recorded).toSorted())
      .toEqual(['evidencePath', 'files', 'generatedAt', 'status', 'totalBytes'])
    expect(Object.keys(recorded.files[0] ?? {}).toSorted()).toEqual(['algo', 'hash', 'path', 'size'])
  })

  it('keeps the hashes and reports evidence_write_failed when the directory cannot be used', async () => {
    const blocker = join(root, 'blocker.txt')
    await writeFile(blocker, 'not a directory')

    const result = await report()
    const failed = await attachEvidence(result, join(blocker, 'evidence'))

    expect(failed.status).toBe('ok')
    expect(failed.files).toEqual(result.files)
    expect(failed.evidencePath).toBeUndefined()
    expect(failed.evidenceError?.code).toBe('evidence_write_failed')
    expect(failed.evidenceError?.message).toContain('evidence')
  })

  it('reports evidence_write_failed when the evidence path is an existing file', async () => {
    const blocker = join(root, 'taken.txt')
    await writeFile(blocker, 'already here')

    const failed = await attachEvidence(await report(), blocker)

    expect(failed.evidenceError?.code).toBe('evidence_write_failed')
  })

  it('leaves a pre-existing directory untouched', async () => {
    const evidenceDir = join(root, 'shared')
    await mkdir(evidenceDir)
    await writeFile(join(evidenceDir, 'keep.txt'), 'unrelated')
    const before = await modeOf(evidenceDir)

    const withEvidence = await attachEvidence(await report(), evidenceDir)

    expect(withEvidence.evidencePath).toBeDefined()
    expect(await readdir(evidenceDir)).toHaveLength(2)
    expect(await modeOf(evidenceDir)).toBe(before)
  })
})
