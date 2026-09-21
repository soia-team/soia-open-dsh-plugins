/**
 * Minimal path-glob matching for gate `when.paths` patterns.
 *
 * Implemented here on purpose: the package ships no runtime dependency and must
 * be bundleable as-is, so the matcher is a pure function over strings and takes
 * nothing from the host.
 *
 * Supported: `**` (zero or more whole path segments, or any suffix when it ends
 * the pattern), `*` (any run of characters inside one segment), `?` (exactly one
 * character inside one segment), and literal characters. Patterns are anchored,
 * case-sensitive, and match the whole path.
 *
 * Not supported: braces, `[abc]` classes, leading `!` negation, and escaping —
 * a pattern using them stays literal text and simply matches nothing.
 */
/**
 * Canonical form a caller-supplied path or pattern is matched in: `/` separators,
 * no leading `./`, no repeated separators, no surrounding whitespace.
 * @param input - Path or pattern, however the caller spelled it.
 * @returns The normalized form.
 */
export declare function normalizePath(input: string): string;
/**
 * Compile one glob pattern into an anchored regular expression.
 * @param pattern - Glob pattern, for example `src/**`.
 * @returns A case-sensitive expression matching a whole normalized path.
 */
export declare function globToRegExp(pattern: string): RegExp;
/**
 * Whether one changed path is selected by one glob pattern.
 * @param path - Changed path, relative to the workspace the config describes.
 * @param pattern - Glob pattern from `when.paths`.
 * @returns True when the whole path matches.
 */
export declare function matchesGlob(path: string, pattern: string): boolean;
