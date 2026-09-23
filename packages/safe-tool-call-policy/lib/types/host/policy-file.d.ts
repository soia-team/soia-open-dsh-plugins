import type { LoadedPolicy, PolicyRule } from '../shared/types.ts';
/** One resolved project policy file. */
export interface PolicyFile {
    readonly path: string;
    readonly format: 'json' | 'yaml';
}
/** Inputs of one policy load. */
export interface LoadPolicyOptions {
    /** Project root: the session workspace, i.e. the directory that owns `.dsh/`. */
    readonly projectRoot: string;
    /** Location of the shipped `danger-patterns.json`. */
    readonly builtinUrl: URL;
}
/**
 * Resolve the project policy file under `projectRoot`, if any.
 *
 * @param projectRoot - directory that would contain `.dsh/`.
 * @returns the first existing candidate, or `undefined`.
 */
export declare function findPolicyFile(projectRoot: string): PolicyFile | undefined;
/**
 * Read and validate the shipped pattern set.
 *
 * @param builtinUrl - URL of `danger-patterns.json`.
 * @returns the rules, or an empty list plus one note when the file is unusable.
 */
export declare function readBuiltinRules(builtinUrl: URL): {
    rules: PolicyRule[];
    notes: string[];
};
/**
 * Load the effective policy for one project root.
 *
 * @param options - project root and the shipped pattern-set location.
 * @returns the effective rules plus every fail-open note. Never throws.
 */
export declare function loadPolicy(options: LoadPolicyOptions): LoadedPolicy;
