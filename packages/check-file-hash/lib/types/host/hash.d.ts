import type { CollectOutcome, HashOneOutcome, HashOptions, HashOutcome } from '../shared/types.ts';
/** The one digest this package speaks. */
export declare const HASH_ALGO = "sha256";
/**
 * Hash one regular file.
 *
 * `not_found` and `unreadable` are separated on purpose: a path that does not
 * exist is a caller mistake, while a path that exists and cannot be read is an
 * environment problem, and the two need different follow-up.
 * @param target - File to hash; resolved against the working directory.
 * @param options - Cancellation forwarded from the tool call.
 * @returns The digest and byte size, or a typed failure naming why it is absent.
 */
export declare function hashOneFile(target: string, options?: HashOptions): Promise<HashOneOutcome>;
/**
 * Resolve caller paths into the regular files they select.
 *
 * Directories are walked recursively; an explicitly passed path that is neither
 * a regular file nor a directory is `not_a_file`; a path that does not exist is
 * `not_found`. The result is de-duplicated and sorted by absolute path, so two
 * runs over the same selection are comparable line by line.
 * @param paths - Files or directories to select from.
 * @param options - Cancellation forwarded from the tool call.
 * @returns Sorted absolute file paths, or a typed failure naming the first bad path.
 */
export declare function collectFiles(paths: readonly string[], options?: HashOptions): Promise<CollectOutcome>;
/**
 * Hash every file the caller's paths select and assemble the report.
 *
 * Files are hashed one at a time in path order. A failure stops the walk at the
 * first offending file and names it, so a caller never has to guess which part of
 * the selection a short list covers.
 * @param paths - Files or directories to hash.
 * @param options - Cancellation forwarded from the tool call.
 * @returns The report, or a typed failure that carries no file list.
 */
export declare function checkFileHash(paths: readonly string[], options?: HashOptions): Promise<HashOutcome>;
