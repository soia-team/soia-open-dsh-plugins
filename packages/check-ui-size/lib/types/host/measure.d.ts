import type { MeasureOptions, MeasureOutcome } from '../shared/types.ts';
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
export declare function resolveBrowserExecutable(explicit?: string): string | undefined;
/**
 * Signed difference between the rendered box and the expected size.
 * @param rect - Measured box.
 * @param expected - Expected size; each side is optional.
 * @returns Differences for the sides that were provided, or undefined when none were.
 */
export declare function diffAgainstExpected(rect: {
    width: number;
    height: number;
}, expected: {
    width?: number;
    height?: number;
} | undefined): {
    width?: number;
    height?: number;
} | undefined;
/**
 * Read one element from one page.
 * @param options - Target URL, selector, optional expected size and overrides.
 * @returns A measured element, or a typed failure explaining why it is absent.
 */
export declare function measureElement(options: MeasureOptions): Promise<MeasureOutcome>;
