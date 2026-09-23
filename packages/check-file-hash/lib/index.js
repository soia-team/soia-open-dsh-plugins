import { defineTool } from "@deepseek-ai/dsh-tools";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createReadStream } from "node:fs";
import { Service } from "@deepseek-ai/cordis";
/** The one code this module reports. */
const WRITE_FAILED = "evidence_write_failed";
/** Build the typed write failure. */
function writeFailure(message) {
	return {
		code: WRITE_FAILED,
		message
	};
}
/** Readable description of a thrown value. */
function describeError$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Node's `code` property, when the thrown value carries one. */
function errorCode$1(error) {
	if (typeof error !== "object" || error === null || !("code" in error)) return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/**
* File name of one record: `hash-<ISO timestamp>.json`.
*
* Every `:` is replaced with `-`, so the same name is legal on Windows, macOS and
* Linux. The timestamp is the report's `generatedAt`, which is why the name is
* derived from the value rather than from a second clock reading.
* @param generatedAt - The report's ISO 8601 timestamp.
* @returns The file name, without a directory.
*/
function evidenceFileName(generatedAt) {
	return `hash-${generatedAt.replaceAll(":", "-")}.json`;
}
/**
* Absolute path of the record for one report.
* @param evidenceDir - Directory the caller asked for.
* @param generatedAt - The report's ISO 8601 timestamp.
* @returns The absolute evidence file path.
*/
function evidenceFilePath(evidenceDir, generatedAt) {
	return join(resolve(evidenceDir), evidenceFileName(generatedAt));
}
/**
* Make sure the caller's evidence directory exists.
*
* A directory this package creates is `0700`. A directory that already existed is
* used as it is and never re-chmoded: the caller may have pointed at a shared
* location on purpose, and narrowing the permissions of someone else's directory
* is not this package's decision to make.
* @param dir - Directory the caller asked for.
* @returns A typed failure when the path is not a usable directory, else undefined.
*/
async function ensureEvidenceDir(dir) {
	const path = resolve(dir);
	try {
		if (!(await stat(path)).isDirectory()) return writeFailure(`not a directory: ${path}`);
		return;
	} catch (error) {
		if (errorCode$1(error) !== "ENOENT") return writeFailure(`could not inspect ${path}: ${describeError$1(error)}`);
	}
	try {
		await mkdir(path, {
			recursive: true,
			mode: 448
		});
		await chmod(path, 448);
	} catch (error) {
		return writeFailure(`could not create ${path}: ${describeError$1(error)}`);
	}
}
/**
* Write one record atomically.
*
* The temporary file is an exclusively created sibling, so a symlink planted at a
* guessable temporary path cannot redirect the write, and it carries the final
* mode through the rename. Any failure removes the temporary file and leaves an
* existing record untouched.
* @param path - Final absolute path of the record.
* @param text - Complete file content.
* @returns A typed failure when nothing was replaced, else undefined.
*/
async function writeEvidenceFile(path, text) {
	const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		const handle = await open(temporary, "wx", 384);
		try {
			await handle.chmod(384);
			await handle.writeFile(text, "utf8");
		} finally {
			await handle.close();
		}
	} catch (error) {
		await rm(temporary, { force: true });
		return writeFailure(`could not write ${path}: ${describeError$1(error)}`);
	}
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		return writeFailure(`could not replace ${path}: ${describeError$1(error)}`);
	}
}
/**
* Attach the written record to a finished report.
*
* The file content is the JSON of the returned value, `evidencePath` included, so
* the record and the tool result can be compared field by field. When the write
* fails the report is returned unchanged apart from `evidenceError`: losing the
* record must not lose the measurements.
* @param result - Successful report from the hashing core.
* @param evidenceDir - Directory the caller asked for.
* @returns The report with `evidencePath`, or with `evidenceError` when it could not be written.
*/
async function attachEvidence(result, evidenceDir) {
	const path = evidenceFilePath(evidenceDir, result.generatedAt);
	const directoryProblem = await ensureEvidenceDir(evidenceDir);
	if (directoryProblem !== void 0) return {
		...result,
		evidenceError: directoryProblem
	};
	const recorded = {
		...result,
		evidencePath: path
	};
	const writeProblem = await writeEvidenceFile(path, `${JSON.stringify(recorded, null, 2)}\n`);
	if (writeProblem !== void 0) return {
		...result,
		evidenceError: writeProblem
	};
	return recorded;
}
//#endregion
//#region packages/check-file-hash/src/host/hash.ts
/**
* Hashing core: resolve the caller's paths, hash every regular file with sha256,
* and assemble one report.
*
* Why hash the bytes instead of trusting a claim: a receipt can name a file, a
* size and a version and still describe content that is not on disk. A digest
* computed from the file itself is the only part of the record that cannot be
* asserted without reading it.
*
* The core never returns a partial file list: a path that cannot be resolved,
* opened or read aborts the call with a typed failure naming that path, because a
* short list would look complete. The one thing that never aborts a check is a
* failed evidence write — see `./evidence.ts`.
*/
/** The one digest this package speaks. */
const HASH_ALGO = "sha256";
/** Node's `code` property, when the thrown value carries one. */
function errorCode(error) {
	if (typeof error !== "object" || error === null || !("code" in error)) return void 0;
	const code = error.code;
	return typeof code === "string" ? code : void 0;
}
/** Readable description of a thrown value. */
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Build a typed failure without a partial file list. */
function failure(code, message, path) {
	return {
		status: "error",
		code,
		message,
		plugin: "soia-dsh-tool-check-file-hash",
		...path === void 0 ? {} : { path }
	};
}
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
async function hashOneFile(target, options = {}) {
	const { signal } = options;
	signal?.throwIfAborted();
	const path = resolve(target);
	let size;
	try {
		const stats = await stat(path);
		if (!stats.isFile()) return failure("not_a_file", `not a regular file: ${path}`, path);
		size = stats.size;
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT" || code === "ENOTDIR") return failure("not_found", `no such file or directory: ${path}`, path);
		return failure("unreadable", `could not inspect ${path}: ${describeError(error)}`, path);
	}
	const digest = createHash(HASH_ALGO);
	try {
		for await (const chunk of createReadStream(path, { signal })) digest.update(chunk);
	} catch (error) {
		signal?.throwIfAborted();
		return failure("unreadable", `could not read ${path}: ${describeError(error)}`, path);
	}
	return {
		status: "ok",
		file: {
			path,
			algo: HASH_ALGO,
			hash: digest.digest("hex"),
			size
		}
	};
}
/**
* List the regular files one directory holds, recursively.
*
* A symlinked file is included and hashed through its target; a symlinked
* directory is not followed, because a cycle has no finite walk. Broken links,
* sockets, FIFOs and devices are skipped: they have no finite bytes to hash, and
* a directory listing is not the place to fail a check over them. An explicit
* caller path is stricter — see {@link collectFiles}.
* @param dir - Directory to walk.
* @param out - Accumulator the found file paths are appended to.
* @param signal - Cancellation forwarded from the tool call.
* @returns A typed failure when a subdirectory cannot be listed, else undefined.
*/
async function collectDirectory(dir, out, signal) {
	signal?.throwIfAborted();
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		signal?.throwIfAborted();
		return failure("unreadable", `could not list ${dir}: ${describeError(error)}`, dir);
	}
	for (const entry of entries) {
		signal?.throwIfAborted();
		const child = join(dir, entry.name);
		if (entry.isDirectory()) {
			const problem = await collectDirectory(child, out, signal);
			if (problem !== void 0) return problem;
			continue;
		}
		if (entry.isFile()) {
			out.push(child);
			continue;
		}
		if (entry.isSymbolicLink()) {
			if ((await stat(child).catch(() => void 0))?.isFile() === true) out.push(child);
		}
	}
}
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
async function collectFiles(paths, options = {}) {
	const { signal } = options;
	const found = [];
	for (const target of paths) {
		signal?.throwIfAborted();
		const path = resolve(target);
		let stats;
		try {
			stats = await stat(path);
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT" || code === "ENOTDIR") return failure("not_found", `no such file or directory: ${path}`, path);
			return failure("unreadable", `could not inspect ${path}: ${describeError(error)}`, path);
		}
		if (stats.isDirectory()) {
			const problem = await collectDirectory(path, found, signal);
			if (problem !== void 0) return problem;
			continue;
		}
		if (!stats.isFile()) return failure("not_a_file", `not a regular file: ${path}`, path);
		found.push(path);
	}
	return {
		status: "ok",
		files: [...new Set(found)].toSorted()
	};
}
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
async function checkFileHash(paths, options = {}) {
	const { signal } = options;
	const collected = await collectFiles(paths, options);
	if (collected.status === "error") return collected;
	const files = [];
	for (const path of collected.files) {
		signal?.throwIfAborted();
		const hashed = await hashOneFile(path, options);
		if (hashed.status === "error") return hashed;
		files.push(hashed.file);
	}
	return {
		status: "ok",
		files,
		generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		totalBytes: files.reduce((total, file) => total + file.size, 0)
	};
}
//#endregion
//#region packages/check-file-hash/src/host/health.ts
/**
* Runtime self-check for this package.
*
* A tool that only reports per-call results cannot say whether it has been
* working: the host sees successes and failures one call at a time, and nothing
* carries the package's own view of its behaviour. These counters do, and they
* are exposed as a host service so a diagnostic surface (or a test) can read
* them without the model paying for a tool schema.
*
* The snapshot is frozen: a caller cannot mutate the package's counters by
* holding on to what it read.
*/
/**
* Counter store behind the service.
*
* A `Service` rather than a plain object because that is how this host attaches
* a lifetime: the counters disappear with the plugin instead of leaking into a
* later composition.
*/
var FileHashHealth = class extends Service {
	calls = 0;
	failures = 0;
	lastCallAt = null;
	lastFailureAt = null;
	evidenceWrites = 0;
	/**
	* @param ctx - host context owning this service's lifetime.
	*/
	constructor(ctx) {
		super(ctx, "checkFileHashHealth");
	}
	/**
	* Record one completed call.
	* @param failed - whether the call ended in a failure report.
	* @param at - epoch milliseconds of completion.
	*/
	record(failed, at = Date.now()) {
		this.calls += 1;
		this.lastCallAt = at;
		if (failed) {
			this.failures += 1;
			this.lastFailureAt = at;
		}
	}
	/** Record one evidence file written. */
	recordEvidenceWrite() {
		this.evidenceWrites += 1;
	}
	/**
	* Read the counters.
	* @returns a frozen snapshot.
	*/
	snapshot() {
		return Object.freeze({
			calls: this.calls,
			failures: this.failures,
			lastCallAt: this.lastCallAt,
			lastFailureAt: this.lastFailureAt,
			evidenceWrites: this.evidenceWrites
		});
	}
};
//#endregion
//#region packages/check-file-hash/src/index.ts
const name = "tool-check-file-hash";
/**
* The `tools` registry is host-provided and must be ready before `apply` runs.
* This package contributes no prompt section, so `systemPrompt` is not injected.
*/
const inject = ["tools"];
/**
* Model-facing tool description. States what it does and when to reach for it,
* and deliberately stops there — usage instructions would be paid for on every
* request, while the model can read the parameter schema for the rest. Failure
* modes are not described either: a failed call returns `status: "error"` with a
* `code`, which the model reads from the result itself.
*/
const TOOL_DESCRIPTION = "Hash files or directories with sha256 and report paths, digests and sizes, to check a receipt's claimed artifact against the actual bytes. Pass evidenceDir to record the report as a JSON file. Prefer it over hand-rolled shell hashing (shasum/openssl): fixed algorithm, structured paths, machine-readable sizes.";
function apply(ctx) {
	const health = new FileHashHealth(ctx);
	ctx.tools.register(defineTool({
		name: "check_file_hash",
		description: TOOL_DESCRIPTION,
		parameters: {
			paths: {
				type: "array",
				required: true,
				items: { type: "string" },
				description: "Files or directories to hash"
			},
			evidenceDir: {
				type: "string",
				description: "Directory for the evidence file (none: do not write)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					status: {
						type: "string",
						required: true
					},
					files: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								path: {
									type: "string",
									required: true
								},
								algo: {
									type: "string",
									required: true
								},
								hash: {
									type: "string",
									required: true
								},
								size: {
									type: "integer",
									required: true
								}
							}
						}
					},
					generatedAt: { type: "string" },
					totalBytes: { type: "integer" },
					evidencePath: { type: "string" },
					evidenceError: {
						type: "object",
						additionalProperties: false,
						properties: {
							code: {
								type: "string",
								required: true
							},
							message: {
								type: "string",
								required: true
							}
						}
					},
					code: { type: "string" },
					message: { type: "string" },
					path: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		async execute(args, exec) {
			const result = await checkFileHash(args.paths, { signal: exec.signal });
			health.record(result.status !== "ok");
			if (result.status !== "ok" || args.evidenceDir === void 0) return result;
			const withEvidence = await attachEvidence(result, args.evidenceDir);
			if (withEvidence.status === "ok") health.recordEvidenceWrite();
			return withEvidence;
		}
	}));
}
//#endregion
export { apply, inject, name };
