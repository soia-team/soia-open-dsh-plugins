import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findGateConfigPath, resolveGateReport } from '../../src/host/config-file.ts'

const VALID_CONFIG = readFileSync(new URL('../fixtures/gates.valid.yml', import.meta.url), 'utf8')
const BROKEN_CONFIG = readFileSync(new URL('../fixtures/gates.broken.yml', import.meta.url), 'utf8')

/** Throwaway roots, removed after each test. */
const roots: string[] = []

/** Create a throwaway workspace, optionally holding `.dsh/gates.yml`. */
function makeWorkspace(config?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'check-quality-gates-'))
  roots.push(root)
  if (config !== undefined) writeConfig(root, config)
  return root
}

/** Write one config file into a workspace. */
function writeConfig(root: string, config: string): void {
  mkdirSync(join(root, '.dsh'), { recursive: true })
  writeFileSync(join(root, '.dsh', 'gates.yml'), config)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('config lookup', () => {
  it('finds the config in a parent directory', () => {
    const root = makeWorkspace(VALID_CONFIG)
    const nested = join(root, 'packages', 'a')
    mkdirSync(nested, { recursive: true })

    expect(findGateConfigPath(nested)).toBe(join(root, '.dsh', 'gates.yml'))
  })

  it('prefers the nearest config when several parents hold one', () => {
    const root = makeWorkspace(VALID_CONFIG)
    const nested = join(root, 'inner')
    writeConfig(nested, 'gates: []\n')

    expect(findGateConfigPath(nested)).toBe(join(nested, '.dsh', 'gates.yml'))
  })
})

describe('resolveGateReport', () => {
  it('builds the report from the discovered config', () => {
    const root = makeWorkspace(VALID_CONFIG)
    const nested = join(root, 'src', 'deep')
    mkdirSync(nested, { recursive: true })

    const report = resolveGateReport({ changedFiles: ['src/a.ts', 'README.md'], cwd: nested })

    expect(report.source).toBe(join(root, '.dsh', 'gates.yml'))
    expect(report.requiredGates.map((gate) => gate.id)).toEqual(['typecheck', 'lint'])
    expect(report.unmatched).toEqual(['README.md'])
    expect(report.error).toBeNull()
    expect(report.enforcement).toBe('none')
  })

  it('honours an explicit configPath resolved against cwd', () => {
    const root = makeWorkspace()
    writeFileSync(join(root, 'other.yml'), 'gates: []\n')

    const report = resolveGateReport({ changedFiles: ['src/a.ts'], cwd: root, configPath: 'other.yml' })

    expect(report.source).toBe(join(root, 'other.yml'))
    expect(report.requiredGates).toEqual([])
    expect(report.unmatched).toEqual(['src/a.ts'])
    expect(report.error).toBeNull()
  })

  it('reports a missing config instead of failing', () => {
    const root = makeWorkspace()

    const report = resolveGateReport({ changedFiles: ['src/a.ts'], cwd: root, configPath: 'nope/gates.yml' })

    expect(report.source).toBe('<not found>')
    expect(report.requiredGates).toEqual([])
    expect(report.unmatched).toEqual(['src/a.ts'])
    expect(report.error).toMatch(/^No gate config found at .*nope\/gates\.yml\.$/)
  })

  it('reports a config path that is a directory instead of failing', () => {
    const root = makeWorkspace()

    const report = resolveGateReport({ changedFiles: [], cwd: root, configPath: '.' })

    expect(report.source).toBe('<not found>')
    expect(report.error).toMatch(/^No gate config found at /)
  })

  it('reports broken YAML with the file and the line, never a crash', () => {
    const root = makeWorkspace(BROKEN_CONFIG)

    const report = resolveGateReport({ changedFiles: ['src/a.ts', 'README.md'], cwd: root })

    expect(report.source).toBe(join(root, '.dsh', 'gates.yml'))
    expect(report.requiredGates).toEqual([])
    expect(report.unmatched).toEqual(['README.md', 'src/a.ts'])
    expect(report.error).toMatch(/^Invalid gate config at .*gates\.yml: unexpected indentation \(line 9\)\.$/)
  })

  it('reports a schema violation with the offending field', () => {
    const root = makeWorkspace('gates:\n  - id: a\n    command: c\n    reason: r\n    rawEvidenceRequired: e\n')

    const report = resolveGateReport({ changedFiles: [], cwd: root })

    expect(report.error).toMatch(/^Invalid gate config at .*: gates\[0\]: missing required key "when"\.$/)
  })

  it('never throws for unusable caller input', () => {
    const root = makeWorkspace('gates: []\n')

    expect(() => resolveGateReport({ changedFiles: [''], cwd: root })).not.toThrow()
    expect(() => resolveGateReport({ changedFiles: [], cwd: root, configPath: '   ' })).not.toThrow()
  })
})

describe('machine-readable failure codes', () => {
  it('names the reason instead of only describing it', () => {
    // A caller that has to pattern-match an English sentence to tell "no config"
    // from "config unreadable" is guessing; the code closes that.
    const empty = makeWorkspace()
    expect(resolveGateReport({ changedFiles: ['src/a.ts'], cwd: empty }).code).toBe('config_not_found')
    expect(resolveGateReport({ changedFiles: ['src/a.ts'], cwd: empty }).error).not.toBeNull()

    const broken = makeWorkspace(BROKEN_CONFIG)
    expect(resolveGateReport({ changedFiles: ['src/a.ts'], cwd: broken }).code).toBe('config_invalid')

    const valid = makeWorkspace(VALID_CONFIG)
    const report = resolveGateReport({ changedFiles: ['src/a.ts'], cwd: valid })
    expect(report.code).toBeNull()
    expect(report.error).toBeNull()
  })
})
