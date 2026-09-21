/**
 * Raised when a project policy document cannot be used at all: unreadable
 * syntax, an unknown top-level shape, or a value the reader refuses to guess
 * at. The caller turns this into a fail-open decision plus a note, so throwing
 * it never blocks a call — it only says "this file cannot be trusted".
 */
export declare class PolicyConfigError extends Error {
    constructor(message: string);
}
