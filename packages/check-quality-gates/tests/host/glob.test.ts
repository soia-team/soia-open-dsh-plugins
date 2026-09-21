import { describe, expect, it } from 'vitest'

import { matchesGlob, normalizePath } from '../../src/host/glob.ts'

/**
 * Glob subset contract: `**` spans segments, `*` and `?` stay inside one
 * segment, patterns are anchored and case-sensitive, and everything else is
 * literal text.
 */
describe('path globs', () => {
  it('lets ** span zero or more whole segments', () => {
    expect(matchesGlob('packages/a/src/x.ts', 'packages/**/src/**')).toBe(true)
    expect(matchesGlob('packages/src/x.ts', 'packages/**/src/**')).toBe(true)
    expect(matchesGlob('packages/a/b/src/deep/x.ts', 'packages/**/src/**')).toBe(true)
    expect(matchesGlob('apps/a/src/x.ts', 'packages/**/src/**')).toBe(false)
  })

  it('lets a trailing ** match any suffix', () => {
    expect(matchesGlob('src/a.ts', 'src/**')).toBe(true)
    expect(matchesGlob('src/deep/a.ts', 'src/**')).toBe(true)
    expect(matchesGlob('src/a/b/c/d.ts', 'src/**')).toBe(true)
    expect(matchesGlob('lib/a.ts', 'src/**')).toBe(false)
  })

  it('keeps * inside one segment and ? on exactly one character', () => {
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true)
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(false)
    expect(matchesGlob('src/?.ts', 'src/?.ts')).toBe(true)
    expect(matchesGlob('src/ab.ts', 'src/?.ts')).toBe(false)
    expect(matchesGlob('a.ts', '*.ts')).toBe(true)
    expect(matchesGlob('src/a.ts', '*.ts')).toBe(false)
  })

  it('anchors the pattern at both ends', () => {
    expect(matchesGlob('src/a.ts', 'src')).toBe(false)
    expect(matchesGlob('src/a.ts', 'a.ts')).toBe(false)
    expect(matchesGlob('a.ts', '**')).toBe(true)
  })

  it('treats regular-expression metacharacters as literal text', () => {
    expect(matchesGlob('src/a+b.ts', 'src/a+b.ts')).toBe(true)
    expect(matchesGlob('src/aaab.ts', 'src/a+b.ts')).toBe(false)
    expect(matchesGlob('src/a.ts', 'src/a.ts')).toBe(true)
    expect(matchesGlob('src/axts', 'src/a.ts')).toBe(false)
    expect(matchesGlob('src/(x).ts', 'src/(x).ts')).toBe(true)
  })

  it('does not match a bare directory against a trailing ** pattern', () => {
    expect(matchesGlob('src', 'src/**')).toBe(false)
  })

  it('normalizes separators and a leading ./ before matching', () => {
    expect(normalizePath('.\\src\\a.ts')).toBe('src/a.ts')
    expect(normalizePath('././src//a.ts')).toBe('src/a.ts')
    expect(matchesGlob('./src/a.ts', 'src/*.ts')).toBe(true)
    expect(matchesGlob('src\\a.ts', 'src/*.ts')).toBe(true)
  })

  it('matches case-sensitively', () => {
    expect(matchesGlob('src/A.ts', 'src/a.ts')).toBe(false)
  })

  it('does not match anything when the pattern is empty', () => {
    expect(matchesGlob('src/a.ts', '')).toBe(false)
  })
})
