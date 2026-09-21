/**
 * Measurement core: open a page in a real browser, read one element's rendered
 * box and the box styles that explain it, and optionally diff that against an
 * expected size.
 *
 * Why a browser instead of parsing CSS: a declaration is not a result. A board
 * can say `min-height: 27px` and the button still renders 34px tall, because
 * line-height, padding, or an oversized child wins. Only the laid-out box tells
 * the truth, so this core reads `getBoundingClientRect()` and `getComputedStyle()`
 * from the live document and reports numbers a receipt can cite.
 *
 * The host half never guesses: a missing browser, a failed navigation, or a selector
 * that matches nothing returns a typed failure rather than a partial result.
 */
/// <reference lib="dom" />
// The probe below is serialized into the page and runs there, so this file needs
// the DOM lib for `document` / `getComputedStyle`. The reference is per file: the
// rest of the repository stays on the Node lib and does not silently gain DOM globals.
import { accessSync, constants } from 'node:fs'

import { chromium } from 'playwright-core'

import type {
  MeasureFailure,
  MeasureFailureCode,
  MeasureOptions,
  MeasureOutcome,
  MeasuredElement,
} from '../shared/types.ts'

/** Candidate browsers, in preference order, when nothing is configured. */
const DEFAULT_BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

/** Default navigation and selector budget. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Round to 3 decimals so float noise never reaches a receipt. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Resolve the browser executable.
 *
 * Order: the explicit option, then `SOIADECK_CHROME_EXECUTABLE` (the same
 * variable SoiaDeck's own browser fixtures already honour), then the usual
 * install locations. Returns undefined when nothing is executable, which the
 * caller reports as `browser_missing` instead of launching a downloaded browser.
 * @param explicit - Caller-provided path, highest priority.
 * @returns An executable path, or undefined when none is found.
 */
export function resolveBrowserExecutable(explicit?: string): string | undefined {
  const fromEnv = process.env['SOIADECK_CHROME_EXECUTABLE']
  const candidates = [explicit, fromEnv, ...DEFAULT_BROWSER_CANDIDATES]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === '') continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Signed difference between the rendered box and the expected size.
 * @param rect - Measured box.
 * @param expected - Expected size; each side is optional.
 * @returns Differences for the sides that were provided, or undefined when none were.
 */
export function diffAgainstExpected(
  rect: { width: number; height: number },
  expected: { width?: number; height?: number } | undefined,
): { width?: number; height?: number } | undefined {
  if (expected === undefined) return undefined
  const diff: { width?: number; height?: number } = {}
  if (typeof expected.width === 'number') diff.width = round(rect.width - expected.width)
  if (typeof expected.height === 'number') diff.height = round(rect.height - expected.height)
  return Object.keys(diff).length > 0 ? diff : undefined
}

/** Build a typed failure without partial measurements. */
function failure(
  code: MeasureFailureCode,
  message: string,
  options: { url: string; selector: string },
): MeasureFailure {
  return { status: 'error', code, message, url: options.url, selector: options.selector }
}

/**
 * Read one element from one page.
 * @param options - Target URL, selector, optional expected size and overrides.
 * @returns A measured element, or a typed failure explaining why it is absent.
 */
export async function measureElement(options: MeasureOptions): Promise<MeasureOutcome> {
  const { url, selector, expected } = options
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const executablePath = resolveBrowserExecutable(options.executablePath)

  if (executablePath === undefined) {
    return failure(
      'browser_missing',
      'no browser executable found; set SOIADECK_CHROME_EXECUTABLE to a Chrome/Chromium binary',
      options,
    )
  }

  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage()
    try {
      await page.goto(url, { waitUntil: 'load', timeout })
    } catch (error) {
      return failure('navigation_failed', `could not load ${url}: ${String(error)}`, options)
    }

    try {
      await page.waitForSelector(selector, { timeout, state: 'attached' })
    } catch {
      return failure('element_not_found', `selector matched no element: ${selector}`, options)
    }

    let measured: MeasuredElement
    try {
      measured = await page.evaluate((sel: string): MeasuredElement => {
        const matches = document.querySelectorAll(sel)
        const element = matches[0]
        if (element === undefined) throw new Error('no element for selector')
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- this whole
        // callback is stringified into the page, so it can only use its own scope.
        const length = (value: string): number | null => {
          const parsed = Number.parseFloat(value)
          return Number.isFinite(parsed) ? parsed : null
        }
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
        return {
          selector: sel,
          matched: matches.length,
          visible,
          rect: {
            x: Math.round(rect.x * 1000) / 1000,
            y: Math.round(rect.y * 1000) / 1000,
            width: Math.round(rect.width * 1000) / 1000,
            height: Math.round(rect.height * 1000) / 1000,
          },
          computed: {
            width: length(style.width) ?? 0,
            height: length(style.height) ?? 0,
            minWidth: length(style.minWidth),
            minHeight: length(style.minHeight),
            maxWidth: length(style.maxWidth),
            maxHeight: length(style.maxHeight),
            paddingTop: length(style.paddingTop) ?? 0,
            paddingBottom: length(style.paddingBottom) ?? 0,
            fontSize: length(style.fontSize) ?? 0,
            lineHeight: length(style.lineHeight),
            boxSizing: style.boxSizing,
            display: style.display,
          },
        }
      }, selector)
    } catch (error) {
      return failure('evaluate_failed', `could not read geometry: ${String(error)}`, options)
    }

    const viewport = page.viewportSize() ?? { width: 0, height: 0 }
    const diff = diffAgainstExpected(measured.rect, expected)
    return {
      ...measured,
      status: 'ok',
      url,
      measuredAt: new Date().toISOString(),
      viewport,
      ...(expected === undefined ? {} : { expected }),
      ...(diff === undefined ? {} : { diff }),
    }
  } finally {
    await browser.close()
  }
}
