/** Keys of the policy document; anything else is reported, not guessed. */
declare const TOP_LEVEL_KEYS: Set<string>;
/**
 * Parse the policy document subset.
 *
 * @param text - the raw file content.
 * @returns one object per top-level key; keys outside `rules`/`disable` are
 *   still returned so the caller can report them.
 * @throws {PolicyConfigError} when the text is not inside the supported subset.
 */
export declare function parseYamlSubset(text: string): Record<string, unknown>;
/** Top-level keys this reader knows; the caller reports the rest as notes. */
export { TOP_LEVEL_KEYS };
