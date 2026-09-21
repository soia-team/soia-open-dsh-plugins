/**
 * Measurement-core tests.
 *
 * The unit cases are pure and always run. The browser cases drive the real
 * measurement path against a local fixture, so they cover what a mock cannot:
 * that the laid-out box — not the declaration — is what gets reported. They are
 * skipped, not faked, when no browser executable is present.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { diffAgainstExpected, measureElement, resolveBrowserExecutable } from '../../src/host/measure.ts'

const FIXTURE_URL = pathToFileURL(
  fileURLToPath(new URL('../fixtures/min-height-mismatch.html', import.meta.url)),
).href

const browserExecutable = resolveBrowserExecutable()

describe('diffAgainstExpected', () => {
  it('returns undefined when no expectation was given', () => {
    expect(diffAgainstExpected({ width: 10, height: 20 }, undefined)).toBeUndefined()
  })

  it('returns undefined when the expectation carries no side', () => {
    expect(diffAgainstExpected({ width: 10, height: 20 }, {})).toBeUndefined()
  })

  it('reports signed differences per provided side only', () => {
    expect(diffAgainstExpected({ width: 100, height: 34 }, { height: 27 })).toEqual({ height: 7 })
    expect(diffAgainstExpected({ width: 100, height: 34 }, { width: 90, height: 34 }))
      .toEqual({ width: 10, height: 0 })
  })

  it('rounds float noise away', () => {
    expect(diffAgainstExpected({ width: 32.5938, height: 1 }, { width: 32.59 }))
      .toEqual({ width: 0.004 })
  })
})

describe('resolveBrowserExecutable', () => {
  it('prefers an explicit path that is executable', () => {
    // process.execPath is a real executable on every supported platform.
    expect(resolveBrowserExecutable(process.execPath)).toBe(process.execPath)
  })

  it('ignores a path that is not executable', () => {
    expect(resolveBrowserExecutable('/nonexistent/browser')).not.toBe('/nonexistent/browser')
  })
})

describe.skipIf(browserExecutable === undefined)('measureElement against the fixture', () => {
  it('reports the laid-out height, not the declared min-height', async () => {
    const result = await measureElement({
      url: FIXTURE_URL,
      selector: '#btn',
      expected: { height: 27 },
      ...(browserExecutable === undefined ? {} : { executablePath: browserExecutable }),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    // The whole point: 34 is the truth, 27 is only what the CSS says.
    expect(result.rect.height).toBe(34)
    expect(result.computed.minHeight).toBe(27)
    expect(result.diff).toEqual({ height: 7 })
    expect(result.matched).toBe(1)
    expect(result.visible).toBe(true)
    expect(result.url).toBe(FIXTURE_URL)
    expect(Number.isNaN(Date.parse(result.measuredAt))).toBe(false)
  })

  it('marks a display:none element as not visible', async () => {
    const result = await measureElement({
      url: FIXTURE_URL,
      selector: '#ghost',
      ...(browserExecutable === undefined ? {} : { executablePath: browserExecutable }),
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.visible).toBe(false)
    expect(result.diff).toBeUndefined()
  })

  it('fails with a typed code when the selector matches nothing', async () => {
    const result = await measureElement({
      url: FIXTURE_URL,
      selector: '#does-not-exist',
      timeoutMs: 2000,
      ...(browserExecutable === undefined ? {} : { executablePath: browserExecutable }),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('element_not_found')
    expect(result.selector).toBe('#does-not-exist')
  })

  it('fails with a typed code when the page cannot be reached', async () => {
    const result = await measureElement({
      url: 'http://127.0.0.1:1/never-listening',
      selector: '#btn',
      timeoutMs: 3000,
      ...(browserExecutable === undefined ? {} : { executablePath: browserExecutable }),
    })

    expect(result.status).toBe('error')
    if (result.status !== 'error') return
    expect(result.code).toBe('navigation_failed')
  })
})
