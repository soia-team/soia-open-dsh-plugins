/**
 * Public types of the measurement core. Kept free of any DSH import so the core
 * can be reused by another host wrapper (an MCP server, for example) without
 * dragging the harness types along.
 */
/** Expected size taken from a board, a spec, or a design token. */
export interface ExpectedSize {
    width?: number;
    height?: number;
}
/** One element's measured geometry, as read from the live document. */
export interface MeasuredElement {
    selector: string;
    /** How many elements the selector matched; geometry is always the first match. */
    matched: number;
    /** False when the element is display:none, visibility:hidden, or zero-sized. */
    visible: boolean;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** Box styles that explain a size mismatch; `null` means the keyword was not a length. */
    computed: {
        width: number;
        height: number;
        minWidth: number | null;
        minHeight: number | null;
        maxWidth: number | null;
        maxHeight: number | null;
        paddingTop: number;
        paddingBottom: number;
        fontSize: number;
        lineHeight: number | null;
        boxSizing: string;
        display: string;
    };
}
/** Successful measurement. `diff` is present only when an expected size was given. */
export interface MeasureSuccess extends MeasuredElement {
    status: 'ok';
    url: string;
    measuredAt: string;
    viewport: {
        width: number;
        height: number;
    };
    expected?: ExpectedSize;
    /** Signed `actual - expected`, in CSS pixels, rounded to 3 decimals. */
    diff?: {
        width?: number;
        height?: number;
    };
}
/** Why a measurement could not be produced. Never carries invented numbers. */
export type MeasureFailureCode = 'browser_missing' | 'navigation_failed' | 'element_not_found' | 'evaluate_failed';
/** Failed measurement: a typed reason instead of a partial or guessed result. */
export interface MeasureFailure {
    status: 'error';
    code: MeasureFailureCode;
    message: string;
    url: string;
    selector: string;
}
/** Result of one measurement attempt. */
export type MeasureOutcome = MeasureSuccess | MeasureFailure;
/** Input of one measurement attempt. */
export interface MeasureOptions {
    url: string;
    selector: string;
    expected?: ExpectedSize;
    /** Overrides browser discovery; defaults to `SOIA_CHROME_EXECUTABLE`. */
    executablePath?: string;
    /** Navigation and selector wait budget, in milliseconds. */
    timeoutMs?: number;
}
