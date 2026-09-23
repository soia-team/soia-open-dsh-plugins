/**
 * Minimal YAML subset parser for the gate config file.
 *
 * The package ships no runtime dependency and no host parser may be pulled in,
 * so this module implements exactly the subset the documented config schema
 * needs: block mappings, block sequences, `- key: value` items, flow sequences
 * of scalars, quoted and plain scalars, comments, blank lines, and one optional
 * leading `---`.
 *
 * Everything outside that subset is **rejected with a readable message and the
 * 1-based line number** instead of being guessed at: tabs in indentation,
 * anchors, aliases, tags, directives, block scalars (`|`, `>`), flow mappings,
 * nested flow collections, multi-line plain scalars, and duplicate keys. A
 * config this parser does not understand must never silently produce a wrong
 * gate list.
 */
/** One scalar value in the supported subset. */
export type YamlScalar = string | number | boolean | null;
/** One parsed value in the supported subset. */
export type YamlValue = YamlScalar | YamlValue[] | {
    [key: string]: YamlValue;
};
/** Syntax failure in the supported subset, carrying the 1-based source line. */
export declare class YamlError extends Error {
    /** 1-based line the failure was found on. */
    readonly line: number;
    constructor(message: string, line: number);
}
/**
 * Parse the supported YAML subset.
 * @param text - Config file contents.
 * @returns The parsed document; an empty document is `null`.
 * @throws YamlError When the text uses syntax outside the supported subset.
 */
export declare function parseYamlSubset(text: string): YamlValue;
