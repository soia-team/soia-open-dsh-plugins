/**
 * Hashing-core tests.
 *
 * Every case builds its own fixture under an OS temporary directory: the package
 * has no fixture directory on purpose, because a hash tool that writes files into
 * its own repository would be measuring itself.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { checkFileHash, collectFiles, hashOneFile } from '../../src/host/hash.ts'

/** One file's bytes, and the sha256 a receipt would quote for them. */
const ABC = 'abc'
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

/** `chmod 000` cannot make a file unreadable for root, so that case is skipped there. */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'check-file-hash-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Write one fixture file, creating its parent directories. */
async function fixture(relativePath: string, content: string): Promise<string> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return path
}

describe('hashOneFile', () => {
  it('reports the digest, the byte size and the absolute path', async () => {
    const path = await fixture('abc.txt', ABC)

    const result = await hashOneFile(path)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.file).toEqual({
      path: join(root, 'abc.txt'),
      algo: 'sha256',
      hash: ABC_SHA256,
      size: 3,
    })
  })

  it('hashes the same content to the same digest regardless of file name', async () => {
    const first = await fixture('one.txt', 'same bytes')
    const second = await fixture('nested/two.txt', 'same bytes')

    const results = await Promise.all([hashOneFile(first), hashOneFile(second)])

    expect(results[0]?.status).toBe('ok')
    expect(results[1]?.status).toBe('ok')
    if (results[0]?.status !== 'ok' || results[1]?.status !== 'ok') return
    expect(results[0].file.hash).toBe(results[1].file.hash)
    expect(results[0].file.hash).toBe(createHash('sha256').update('same bytes').digest('hex'))
  })

  it('fails with not_found for a path that does not exist', async () => {
    const result = await hashOneFile(join(root, 'absent.txt'))

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('not_found')
    expect(result.path).toBe(join(root, 'absent.txt'))
  })

  it('fails with not_a_file when a directory is handed to the single-file path', async () => {
    const directory = join(root, 'a-directory')
    await mkdir(directory)

    const result = await hashOneFile(directory)

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('not_a_file')
    expect(result.path).toBe(directory)
  })

  it('fails with unreadable when the path cannot be resolved', async () => {
    // Two symlinks pointing at each other: the path exists, and no amount of
    // resolution reaches a file, which is an environment problem, not a typo.
    await symlink(join(root, 'loop-b'), join(root, 'loop-a'))
    await symlink(join(root, 'loop-a'), join(root, 'loop-b'))

    const result = await hashOneFile(join(root, 'loop-a'))

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('unreadable')
  })

  it.skipIf(isRoot)('fails with unreadable when the file cannot be opened', async () => {
    const path = await fixture('locked.txt', ABC)
    await chmod(path, 0o000)

    const result = await hashOneFile(path)

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('unreadable')
  })
})

describe('collectFiles', () => {
  it('walks a directory recursively and returns absolute paths', async () => {
    await fixture('top.txt', 'top')
    await fixture('nested/deep/leaf.txt', 'leaf')

    const result = await collectFiles([root])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.files).toEqual([
      join(root, 'nested/deep/leaf.txt'),
      join(root, 'top.txt'),
    ])
  })

  it('orders the selection stably and independently of the argument order', async () => {
    await fixture('b/second.txt', 'second')
    await fixture('b/first.txt', 'first')
    await fixture('a.txt', 'a')

    const forward = await checkFileHash([join(root, 'b'), join(root, 'a.txt')])
    const backward = await checkFileHash([join(root, 'a.txt'), join(root, 'b')])

    expect(forward.status).toBe('ok')
    expect(backward.status).toBe('ok')
    if (forward.status !== 'ok' || backward.status !== 'ok') return

    const paths = forward.files.map((file) => file.path)
    expect(paths).toEqual(paths.toSorted())
    expect(backward.files).toEqual(forward.files)
  })

  it('collapses a path that was passed twice into one row', async () => {
    const path = await fixture('once.txt', ABC)

    const result = await checkFileHash([path, path, root])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.path).toBe(path)
  })

  it('skips a symlinked directory instead of following it', async () => {
    await fixture('real/file.txt', 'content')
    await symlink(join(root, 'real'), join(root, 'link'))

    const result = await collectFiles([root])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.files).toEqual([join(root, 'real/file.txt')])
  })

  it('reports a missing path as not_found rather than returning the rest', async () => {
    await fixture('present.txt', ABC)

    const result = await collectFiles([join(root, 'present.txt'), join(root, 'absent.txt')])

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('not_found')
    expect(result.path).toBe(join(root, 'absent.txt'))
  })

  it.skipIf(!existsSync('/dev/null'))('reports an explicitly passed non-regular path as not_a_file', async () => {
    // A character device is not a directory and not a regular file: hashing it has
    // no finite end, so an explicit caller path is rejected instead of skipped.
    const result = await collectFiles(['/dev/null'])

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('not_a_file')
    expect(result.path).toBe('/dev/null')
  })
})

describe('checkFileHash', () => {
  it('returns an empty report for an empty directory', async () => {
    const empty = join(root, 'empty')
    await mkdir(empty)

    const result = await checkFileHash([empty])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.files).toEqual([])
    expect(result.totalBytes).toBe(0)
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false)
  })

  it('sums the byte sizes of every selected file', async () => {
    await fixture('one.txt', ABC)
    await fixture('two.txt', 'de')

    const result = await checkFileHash([root])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.totalBytes).toBe(5)
  })

  it('writes no evidence file and names no evidence path by default', async () => {
    await fixture('abc.txt', ABC)

    const result = await checkFileHash([root])

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect('evidencePath' in result).toBe(false)
    expect(result.evidencePath).toBeUndefined()
  })

  it('rejects with the signal reason instead of reporting a typed failure', async () => {
    await fixture('abc.txt', ABC)
    const controller = new AbortController()
    controller.abort()

    await expect(checkFileHash([root], { signal: controller.signal })).rejects.toThrow()
  })
})
