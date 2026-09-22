import { defineTool } from "@deepseek-ai/dsh-tools";
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { Service } from "@deepseek-ai/cordis";
//#region packages/check-skills/src/host/session.ts
/**
* Session-log reader: locate, decompress and parse the JSONL artifact DSH
* persists a session into.
*
* Two physical facts drive this module, both established by reading real logs
* under `$DSH_HOME/sessions` rather than by assumption:
*
* 1. The artifact is a **concatenated-frame** Zstandard container, not a single
*    frame: the writer appends one independently decodable frame per durable
*    batch. `node:zlib`'s one-shot `zstdDecompressSync` returns only the first
*    frame, so reading it alone silently yields just the session header. The
*    frames are therefore located structurally and decoded one by one.
* 2. Generation `v0` wrote one JSON record per line; later generations append
*    records without a separating newline. A line-oriented parse would fuse a
*    whole batch into one unparseable row, so the parser accepts both.
*
* The reader never guesses: an unreadable, empty or undecodable artifact comes
* back as a typed code, and rows that fail to parse are counted and dropped
* rather than repaired.
*/
/**
* Zstandard decoder, resolved by capability probe rather than by a static named
* import.
*
* A static `import { zstdDecompressSync } from 'node:zlib'` is a **module
* instantiation** error on a Node build whose zlib has no such export: the whole
* plugin fails to load with `SyntaxError: The requested module 'node:zlib' does
* not provide an export named ...`, and the typed `zstd_unsupported` answer this
* package promises can never be produced, because the module never finishes
* evaluating. Reading it off the namespace keeps the failure at call time, where
* it becomes a readable code.
*/
const zstdDecompressSync = zlib.zstdDecompressSync;
/** Default session root, used when `$DSH_HOME` is absent. */
const DEFAULT_DSH_HOME_SEGMENTS = [".dsh"];
/** Bytes of a file read when only its shape is being inspected. */
const PEEK_BYTES = 4;
/** Zstandard frame magic number, little-endian on disk: `28 B5 2F FD`. */
const ZSTD_MAGIC = [
	40,
	181,
	47,
	253
];
/** Candidate artifact names, most current generation first. */
const ARTIFACT_SUFFIXES = [".jsonl.zstd", ".jsonl"];
/**
* Typed reader failure. Carries the code the tool reports, so the caller never
* has to translate a message string into a decision.
*/
var SessionReadError = class extends Error {
	code;
	sessionPath;
	constructor(code, message, sessionPath) {
		super(message);
		this.name = "SessionReadError";
		this.code = code;
		this.sessionPath = sessionPath;
	}
};
/**
* `$DSH_HOME`, or `~/.dsh` when the host did not set it.
* @returns Absolute session root directory.
*/
function defaultSessionsDir() {
	const home = process.env["DSH_HOME"];
	if (home !== void 0 && home !== "") return join(home, "sessions");
	return join(homedir(), ...DEFAULT_DSH_HOME_SEGMENTS, "sessions");
}
/**
* Find the first occurrence of the Zstandard frame magic at or after `from`.
* @param buffer - bytes to scan.
* @param from - inclusive index to start at.
* @returns Index of the magic, or -1 when absent.
*/
function findFrameMagic(buffer, from) {
	const last = buffer.length - ZSTD_MAGIC.length;
	for (let index = Math.max(from, 0); index <= last; index += 1) {
		if (buffer[index] !== ZSTD_MAGIC[0]) continue;
		if (buffer[index + 1] !== ZSTD_MAGIC[1]) continue;
		if (buffer[index + 2] !== ZSTD_MAGIC[2]) continue;
		if (buffer[index + 3] !== ZSTD_MAGIC[3]) continue;
		return index;
	}
	return -1;
}
/**
* Decode a concatenated-frame Zstandard buffer.
*
* Frames are located by magic scan and each is handed to the one-shot decoder,
* because the one-shot API consumes only the leading frame and reports nothing
* about the bytes it left behind. A frame that fails to decode is treated as a
* torn tail: its bytes stay undecoded and the text accumulated so far is
* returned, which is what the writer leaves behind after an interrupted append.
*
* @param buffer - raw artifact bytes.
* @returns Plaintext plus how many frames decoded and whether a tail was dropped.
* @throws SessionReadError `zstd_unsupported` when this Node build has no zstd
* decoder, or Error when no frame decodes at all.
*/
function decompressZstdFrames(buffer) {
	const decode = zstdDecompressSync;
	if (decode === void 0) throw unsupportedError();
	const starts = [];
	let cursor = findFrameMagic(buffer, 0);
	while (cursor !== -1) {
		starts.push(cursor);
		cursor = findFrameMagic(buffer, cursor + ZSTD_MAGIC.length);
	}
	if (starts.length === 0) return {
		text: decode(buffer).toString("utf8"),
		frameCount: 1,
		truncatedTail: false
	};
	const decoded = [];
	let dropped = 0;
	for (const [index, start] of starts.entries()) {
		const end = starts[index + 1] ?? buffer.length;
		try {
			decoded.push(decode(buffer.subarray(start, end)).toString("utf8"));
		} catch {
			dropped += 1;
			break;
		}
	}
	if (decoded.length === 0) throw new Error("no complete Zstandard frame decoded");
	return {
		text: decoded.join(""),
		frameCount: decoded.length,
		truncatedTail: dropped > 0
	};
}
/** The typed answer for a Node build with no zstd decoder. */
function unsupportedError() {
	return new SessionReadError("zstd_unsupported", "this Node build has no zlib.zstdDecompressSync; Node >= 22.15 is required to read .jsonl.zstd artifacts");
}
/**
* Decompress an artifact by its suffix.
* @param buffer - raw bytes.
* @param suffix - artifact suffix the bytes came from.
* @returns Plaintext plus frame accounting.
* @throws SessionReadError `zstd_unsupported`, or Error when decoding fails.
*/
function decompress(buffer, suffix) {
	if (suffix === ".jsonl") return {
		text: buffer.toString("utf8"),
		frameCount: 0,
		truncatedTail: false
	};
	if (typeof zstdDecompressSync !== "function") throw unsupportedError();
	return decompressZstdFrames(buffer);
}
/**
* Read up to `PEEK_BYTES` from an open descriptor without disturbing position.
* @param fd - Open file descriptor.
* @returns The bytes actually read, which may be shorter than requested.
*/
function peek(fd) {
	const head = Buffer.alloc(PEEK_BYTES);
	const read = readSync(fd, head, 0, PEEK_BYTES, 0);
	return head.subarray(0, read);
}
/**
* True when the first bytes of `path` are a Zstandard frame, read from a file
* descriptor so no second full read is needed to decide how to decode.
* @param path - Candidate artifact path.
* @returns Whether the bytes start with the frame magic.
*/
function startsWithZstdMagic(path) {
	let fd;
	try {
		fd = openSync(path, "r");
		return findFrameMagic(peek(fd), 0) === 0;
	} catch {
		return false;
	} finally {
		if (fd !== void 0) closeSync(fd);
	}
}
/**
* Resolve a session artifact path that actually exists.
*
* A caller-supplied path is taken literally. The default resolves the newest
* artifact under `$DSH_HOME/sessions`, searched to a bounded depth because the
* layout is `<cwd-key>/<session-id>/session*.jsonl*`.
*
* @param explicit - Caller-supplied path, or undefined to pick the newest.
* @returns Absolute path of an existing artifact.
* @throws SessionReadError with a typed code when nothing is resolvable.
*/
function resolveSessionPath(explicit) {
	if (explicit !== void 0 && explicit.trim() !== "") {
		const path = explicit.trim();
		let stats;
		try {
			stats = statSync(path);
		} catch {
			throw new SessionReadError("session_not_found", `no session artifact at ${path}`, path);
		}
		if (stats.isFile()) return path;
		const inDirectory = findNewestArtifact(path, 1);
		if (inDirectory === void 0) throw new SessionReadError("session_not_found", `no session artifact inside ${path}`, path);
		return inDirectory;
	}
	const root = defaultSessionsDir();
	try {
		if (!statSync(root).isDirectory()) throw new SessionReadError("sessions_dir_missing", `session root is not a directory: ${root}`, root);
	} catch (error) {
		if (error instanceof SessionReadError) throw error;
		throw new SessionReadError("sessions_dir_missing", `no session root at ${root}`, root);
	}
	const newest = findNewestArtifact(root, 4);
	if (newest === void 0) throw new SessionReadError("sessions_dir_empty", `no session artifact under ${root}`, root);
	return newest;
}
/**
* Newest session artifact at or below `dir`.
* @param dir - Directory to search.
* @param depth - Remaining directory levels to descend.
* @returns Path of the newest artifact, or undefined when there is none.
*/
function findNewestArtifact(dir, depth) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	let best;
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (depth <= 0) continue;
			const nested = findNewestArtifact(path, depth - 1);
			if (nested === void 0) continue;
			let nestedStats;
			try {
				nestedStats = statSync(nested);
			} catch {
				continue;
			}
			if (best === void 0 || nestedStats.mtimeMs > best.mtimeMs) best = {
				path: nested,
				mtimeMs: nestedStats.mtimeMs
			};
			continue;
		}
		if (ARTIFACT_SUFFIXES.find((candidate) => entry.name.endsWith(candidate)) === void 0) continue;
		if (!entry.name.startsWith("session")) continue;
		let stats;
		try {
			stats = statSync(path);
		} catch {
			continue;
		}
		if (best === void 0 || stats.mtimeMs > best.mtimeMs) best = {
			path,
			mtimeMs: stats.mtimeMs
		};
	}
	return best?.path;
}
/**
* Free JSON values on one line, in order.
*
* The log concatenates records without newlines in later generations, so a line
* can carry several objects; `JSON.parse` accepts trailing bytes and reports in
* its error how far it got, which is what advances the cursor here.
*
* @param line - One non-empty log line.
* @returns Every complete JSON value found, plus what was left unconsumed.
*/
function parseConcatenatedJson(line) {
	const values = [];
	let rest = line.trim();
	while (rest !== "") try {
		values.push(JSON.parse(rest));
		return {
			values,
			rest: ""
		};
	} catch (error) {
		const consumed = consumedLength(error);
		if (consumed === void 0 || consumed >= rest.length) return {
			values,
			rest
		};
		try {
			values.push(JSON.parse(rest.slice(0, consumed)));
		} catch {
			return {
				values,
				rest
			};
		}
		rest = rest.slice(consumed).trim();
	}
	return {
		values,
		rest
	};
}
/**
* How many characters `JSON.parse` reports having consumed before it failed.
*
* V8 words the position as either "at position N" (offset of the offending
* character) or "at line L column C"; both are handled, and an unrecognised
* message yields undefined so the row is dropped instead of mis-sliced.
*
* @param error - The error thrown by `JSON.parse`.
* @returns Character count consumed, or undefined when it cannot be told.
*/
function consumedLength(error) {
	const message = error instanceof Error ? error.message : "";
	const position = /at position (\d+)/.exec(message);
	if (position?.[1] !== void 0) {
		const value = Number.parseInt(position[1], 10);
		return Number.isSafeInteger(value) && value > 0 ? value : void 0;
	}
	const lineColumn = /at line (\d+) column (\d+)/.exec(message);
	if (lineColumn?.[1] !== void 0 && lineColumn[2] !== void 0) {
		const line = Number.parseInt(lineColumn[1], 10);
		const column = Number.parseInt(lineColumn[2], 10);
		if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line !== 1) return void 0;
		return column > 1 ? column - 1 : void 0;
	}
}
/** True when a decoded JSON value looks like a session event row. */
function isSessionEvent(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return typeof value.type === "string";
}
/**
* Parse decoded log text into event rows.
*
* Every non-empty row is attempted. A row that is not valid JSON, or that JSON
* but not an event object, is counted as malformed and dropped; it is never
* reconstructed from neighbouring rows.
*
* @param text - Decoded log plaintext.
* @returns The events in log order and the malformed-row count.
*/
function parseSessionLog(text) {
	const events = [];
	let malformedLineCount = 0;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (line === "") continue;
		const { values } = parseConcatenatedJson(line);
		if (values.length === 0) {
			malformedLineCount += 1;
			continue;
		}
		for (const value of values) if (isSessionEvent(value)) events.push(value);
		else malformedLineCount += 1;
	}
	return {
		events,
		malformedLineCount
	};
}
/**
* Read and decode one session artifact.
* @param path - Absolute artifact path.
* @returns Events, malformed-row count and frame accounting.
* @throws SessionReadError with a typed code for every failure mode.
*/
function readSessionLog(path) {
	let buffer;
	try {
		buffer = readFileSync(path);
	} catch (error) {
		throw new SessionReadError("session_unreadable", `could not read ${path}: ${String(error)}`, path);
	}
	if (buffer.length === 0) throw new SessionReadError("session_empty", `session artifact is empty: ${path}`, path);
	const compressed = (ARTIFACT_SUFFIXES.find((candidate) => path.endsWith(candidate)) ?? "") === ".jsonl.zstd" || startsWithZstdMagic(path);
	let decoded;
	try {
		decoded = decompress(buffer, compressed ? ".jsonl.zstd" : ".jsonl");
	} catch (error) {
		if (error instanceof SessionReadError) throw error;
		throw new SessionReadError("session_decompress_failed", `could not decompress ${path}: ${String(error)}`, path);
	}
	const { events, malformedLineCount } = parseSessionLog(decoded.text);
	return {
		sessionPath: path,
		events,
		malformedLineCount,
		frameCount: decoded.frameCount,
		truncatedTail: decoded.truncatedTail
	};
}
/**
* Resolve and read in one step.
* @param explicit - Caller-supplied artifact path, or undefined for the newest.
* @returns The decoded session analysis.
* @throws SessionReadError with a typed code.
*/
function loadSession(explicit) {
	return readSessionLog(resolveSessionPath(explicit));
}
/** Mode bits for the evidence file: owner read/write only. */
const EVIDENCE_MODE = 384;
/**
* Worst-first ranking used to collapse per-skill verdicts into one overall
* verdict. Assembly problems outrank selection problems, which outrank
* follow-through problems; `ok` outranks nothing.
*/
const VERDICT_SEVERITY = {
	ok: 0,
	loaded_not_effective: 1,
	not_attempted: 2,
	wrong_pick: 3,
	not_in_catalog: 4,
	unreported: -1
};
/** Read one field off an event's `data` bag without asserting its shape. */
function dataOf(event) {
	const data = event.data;
	return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}
/** Read a nested object field, or undefined when it is not a plain object. */
function objectField(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/**
* Read one catalog entry list off a `skill-catalog` source.
*
* An entry with a non-string or empty `name`, or a non-string `description`, is
* enough to reject the whole record — the same posture the loader takes when it
* decides whether a stored record is its own catalog. A rejected record is
* skipped, and an older readable catalog stays the effective one.
*
* @param source - The message's `source` object.
* @returns Readable entries, or undefined when the record is not usable.
*/
function readCatalogEntries(source) {
	const entries = source["entries"];
	if (!Array.isArray(entries)) return void 0;
	const readable = [];
	for (const entry of entries) {
		const record = objectField(entry);
		if (record === void 0) return void 0;
		const name = record["name"];
		const description = record["description"];
		if (typeof name !== "string" || name === "" || typeof description !== "string") return void 0;
		readable.push({
			name,
			description
		});
	}
	return readable;
}
/**
* The session's effective skill catalog.
*
* The loader appends a complete replacement whenever the catalog changes, and an
* empty replacement is an explicit retirement of earlier names, so the **last**
* readable catalog event is the session's current catalog — never a union of
* every catalog ever published.
*
* @param events - Decoded session events in log order.
* @returns The effective catalog, with `present: false` when none was published.
*/
function extractCatalog(events) {
	const empty = {
		present: false,
		count: 0,
		names: [],
		entries: []
	};
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === void 0 || event.type !== "user/message") continue;
		const source = objectField(dataOf(event)["source"]);
		if (source === void 0 || source["kind"] !== "skill-catalog") continue;
		const entries = readCatalogEntries(source);
		if (entries === void 0) continue;
		return {
			present: true,
			count: entries.length,
			names: entries.map((entry) => entry.name),
			entries
		};
	}
	return empty;
}
/**
* Read the `arguments` field of a `tool/call` event.
*
* The log stores arguments as a JSON **string**; an already-parsed object is
* also accepted because the field is not schema-checked on read.
*
* @param raw - The event's raw `arguments` value.
* @returns The parsed arguments, or undefined when they are unusable.
*/
function readCallArguments(raw) {
	let parsed = raw;
	if (typeof raw === "string") try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	const record = objectField(parsed);
	if (record === void 0) return void 0;
	const name = record["name"];
	if (typeof name !== "string" || name === "") return void 0;
	return { name };
}
/**
* Every `skill` tool call in the log, in call order.
* @param events - Decoded session events.
* @returns Calls that carry a usable skill name.
*/
function extractRawCalls(events) {
	const calls = [];
	for (const event of events) {
		if (event.type !== "tool/call") continue;
		const data = dataOf(event);
		if (data["name"] !== "skill") continue;
		const callId = data["callId"];
		if (typeof callId !== "string" || callId === "") continue;
		const args = readCallArguments(data["arguments"]);
		if (args === void 0) continue;
		calls.push({
			callId,
			name: args.name,
			...typeof event.seq === "number" ? { seq: event.seq } : {},
			...typeof data["turn"] === "number" ? { turn: data["turn"] } : {},
			...typeof data["step"] === "number" ? { step: data["step"] } : {}
		});
	}
	return calls;
}
/**
* First text block of a result's inner content, when it has one.
* @param content - The `tool-result` block's `content` array.
* @returns The text, or undefined when there is none.
*/
function firstResultText(content) {
	if (!Array.isArray(content)) return void 0;
	for (const block of content) {
		const record = objectField(block);
		if (record === void 0 || record["type"] !== "text") continue;
		const text = record["text"];
		if (typeof text === "string") return text;
	}
}
/**
* Every tool result in the log, keyed for pairing with its call.
*
* A result row nests the model-facing message: the result block lives at
* `data.message.content[0]` and its `toolCallId` is what ties it back to the
* call. Error text is kept because a failed load is a different verdict input
* from a load that never happened.
*
* @param events - Decoded session events.
* @returns Results in log order.
*/
function extractRawResults(events) {
	const results = [];
	for (const event of events) {
		if (event.type !== "tool/result") continue;
		const content = objectField(dataOf(event)["message"])?.["content"];
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			const record = objectField(block);
			if (record === void 0 || record["type"] !== "tool-result") continue;
			const callId = record["toolCallId"];
			if (typeof callId !== "string" || callId === "") continue;
			const isError = record["isError"] === true;
			const text = isError ? firstResultText(record["content"]) : void 0;
			results.push({
				callId,
				isError,
				...typeof event.seq === "number" ? { seq: event.seq } : {},
				...text === void 0 ? {} : { errorText: text }
			});
		}
	}
	return results;
}
/**
* Distinct tool names called anywhere in the log, in call order.
* @param events - Decoded session events.
* @returns Tool names, excluding `skill` itself.
*/
function extractToolNames(events) {
	const names = [];
	for (const event of events) {
		if (event.type !== "tool/call") continue;
		const name = dataOf(event)["name"];
		if (typeof name !== "string" || name === "") continue;
		if (name === "skill") continue;
		if (!names.includes(name)) names.push(name);
	}
	return names;
}
/**
* One row per distinct skill the session called, carrying the latest attempt.
*
* A skill loaded twice is one record: the later call is the one whose
* follow-through decides `loaded_not_effective`, and mixing an early empty load
* with a later productive one would accuse the session wrongly.
*
* @param events - Decoded session events.
* @returns Load records in first-call order.
*/
function extractSkillLoads(events) {
	const calls = extractRawCalls(events);
	const results = extractRawResults(events);
	const resultsByCallId = new Map(results.map((result) => [result.callId, result]));
	/** Sequence numbers of non-`skill` tool calls, for the follow-through test. */
	const otherCallSeqs = [];
	for (const event of events) {
		if (event.type !== "tool/call") continue;
		if (dataOf(event)["name"] === "skill") continue;
		if (typeof event.seq === "number") otherCallSeqs.push(event.seq);
	}
	const order = [];
	const latest = /* @__PURE__ */ new Map();
	for (const call of calls) {
		const result = resultsByCallId.get(call.callId);
		let ok = false;
		let reason = "no_result";
		let error;
		if (result !== void 0) {
			ok = !result.isError;
			reason = ok ? void 0 : "call_failed";
			if (!ok) error = result.errorText ?? "skill call failed";
		}
		const seq = call.seq;
		const usedAfterLoad = ok && seq !== void 0 && otherCallSeqs.some((other) => other > seq);
		const record = {
			name: call.name,
			...call.turn === void 0 ? {} : { turn: call.turn },
			...call.step === void 0 ? {} : { step: call.step },
			...call.seq === void 0 ? {} : { seq: call.seq },
			ok,
			...reason === void 0 ? {} : { reason },
			...error === void 0 ? {} : { error },
			usedAfterLoad
		};
		if (!latest.has(call.name)) order.push(call.name);
		latest.set(call.name, record);
	}
	return order.flatMap((name) => {
		const record = latest.get(name);
		return record === void 0 ? [] : [record];
	});
}
/**
* Every derived fact the audit needs from one session log.
* @param analysis - A decoded session artifact.
* @returns Catalog, load records, called skills and observed tool names.
*/
function collectSkillUsage(analysis) {
	const loads = extractSkillLoads(analysis.events);
	return {
		catalog: extractCatalog(analysis.events),
		loads,
		calledSkills: loads.map((load) => load.name),
		toolNames: extractToolNames(analysis.events)
	};
}
/**
* Normalise a caller-supplied skill list.
*
* Blank entries are dropped, surrounding whitespace is trimmed, and duplicates
* are collapsed keeping first-seen order, so a repeated name cannot produce two
* verdict rows for one expectation.
*
* @param names - Raw caller input.
* @returns The cleaned list.
*/
function normalizeApplicableSkills(names) {
	const cleaned = [];
	for (const raw of names) {
		const name = raw.trim();
		if (name === "" || cleaned.includes(name)) continue;
		cleaned.push(name);
	}
	return cleaned;
}
/**
* Classify one expected skill.
*
* Order matters and is deliberate: `not_in_catalog` is decided first, because a
* skill that was never offered cannot fairly be reported as "not attempted" —
* that would blame the model for an assembly problem.
*
* @param name - The expected skill name.
* @param input - Catalog, load records and the expectation list.
* @returns `ok`, `not_in_catalog`, `not_attempted`, `wrong_pick` or
* `loaded_not_effective`.
*/
function classifySkill(name, input) {
	if (!(input.catalog.present && input.catalog.names.includes(name))) return "not_in_catalog";
	const load = input.loads.find((record) => record.name === name);
	if (load === void 0) return input.loads.length > 0 ? "wrong_pick" : "not_attempted";
	if (!load.ok) return "not_attempted";
	return load.usedAfterLoad ? "ok" : "loaded_not_effective";
}
/**
* Classify every expected skill and collapse the results into one verdict.
*
* A skill that was called and whose instructions were followed counts as `ok`
* even when `usedAfterLoad` is false, provided something else in the session
* shows work continuing — the overall verdict is the worst per-skill verdict,
* so one bad expectation is never hidden by a good one.
*
* @param input - Catalog, load records and the expectation list.
* @returns The overall verdict, per-skill rows and the missing names.
*/
function classifySession(input) {
	if (input.applicableSkills.length === 0) return {
		verdict: "unreported",
		perSkill: [],
		missing: []
	};
	const perSkill = input.applicableSkills.map((name) => ({
		name,
		verdict: classifySkill(name, input)
	}));
	let verdict = "ok";
	for (const record of perSkill) if (VERDICT_SEVERITY[record.verdict] > VERDICT_SEVERITY[verdict]) verdict = record.verdict;
	return {
		verdict,
		perSkill,
		missing: perSkill.filter((record) => record.verdict !== "ok").map((record) => record.name)
	};
}
/**
* The catalog slice of the result.
* @param evidence - Collected session evidence.
* @returns Count, names, whether a catalog was published, and what was called.
*/
function summarizeCatalog(evidence) {
	return {
		count: evidence.catalog.count,
		names: [...evidence.catalog.names],
		present: evidence.catalog.present,
		called: [...evidence.calledSkills]
	};
}
/**
* Render the optional markdown evidence report.
* @param input - Everything the audit concluded.
* @returns Markdown text.
*/
function renderEvidenceReport(input) {
	const lines = [
		"# Skill usage audit",
		"",
		`- Session: \`${input.sessionPath}\``,
		`- Recorded: ${input.recordedAt}`,
		`- Verdict: \`${input.verdict}\``,
		`- Expected: ${input.applicableSkills.length === 0 ? "(none reported)" : input.applicableSkills.map((name) => `\`${name}\``).join(", ")}`,
		`- Catalog: ${input.catalog.present ? `${input.catalog.count} skill(s)` : "no catalog event in this session"}`,
		`- Missing: ${input.missing.length === 0 ? "(none)" : input.missing.map((name) => `\`${name}\``).join(", ")}`,
		"",
		"## Per skill",
		""
	];
	if (input.perSkill.length === 0) lines.push("No expectation list was provided, so nothing can be classified.", "");
	else {
		lines.push("| Skill | Verdict | In catalog | Loaded | Follow-through |", "|---|---|---|---|---|");
		for (const record of input.perSkill) {
			const load = input.calls.find((call) => call.name === record.name);
			const loaded = load === void 0 ? "no" : load.ok ? "yes" : `failed (${load.reason ?? "unknown"})`;
			const followThrough = load === void 0 || !load.ok ? "—" : load.usedAfterLoad ? "yes" : "none";
			lines.push(`| \`${record.name}\` | \`${record.verdict}\` | ${input.catalog.names.includes(record.name) ? "yes" : "no"} | ${loaded} | ${followThrough} |`);
		}
		lines.push("");
	}
	lines.push("## Skill calls in this session", "");
	if (input.calls.length === 0) lines.push("The session called the `skill` tool zero times.", "");
	else {
		lines.push("| Skill | Result | Turn | Step | Note |", "|---|---|---|---|---|");
		for (const call of input.calls) {
			const result = call.ok ? "ok" : `\`${call.reason ?? "failed"}\``;
			const note = call.error === void 0 ? call.usedAfterLoad ? "work continued after this load" : "no later tool call" : call.error.replaceAll("|", "\\|");
			lines.push(`| \`${call.name}\` | ${result} | ${call.turn ?? "—"} | ${call.step ?? "—"} | ${note} |`);
		}
		lines.push("");
	}
	lines.push("## Verdict criteria", "", "- `ok` — expected, in the catalog, loaded successfully.", "- `not_in_catalog` — not offered by the session catalog (assembly problem).", "- `not_attempted` — offered, but no successful `skill` call for it.", "- `wrong_pick` — offered and not called, while another skill was called.", "- `loaded_not_effective` — loaded, but no later non-`skill` tool call follows it.", "- `unreported` — the caller supplied no expectation list.", "");
	return lines.join("\n");
}
/**
* Write the evidence report atomically: a private temporary file in the target
* directory, then a rename onto the final name. A rename within one directory is
* atomic, so a reader never observes a partial report, and the temporary file is
* removed on every failure path so no stray file is left behind.
*
* @param dir - Target directory, created when missing.
* @param recordedAt - ISO timestamp used in the file name.
* @param text - Report body.
* @returns Absolute path of the written report.
*/
function writeEvidenceReport(dir, recordedAt, text) {
	mkdirSync(dir, { recursive: true });
	const stamp = recordedAt.replaceAll(":", "").replaceAll(".", "");
	const target = join(dir, `skill-usage-${stamp}.md`);
	const temporary = `${target}.tmp`;
	try {
		writeFileSync(temporary, text, {
			encoding: "utf8",
			mode: EVIDENCE_MODE
		});
		renameSync(temporary, target);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
	return target;
}
//#endregion
//#region packages/check-skills/src/host/health.ts
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
var SkillsHealth = class extends Service {
	calls = 0;
	failures = 0;
	lastCallAt = null;
	lastFailureAt = null;
	sessionsRead = 0;
	decodeFailures = 0;
	/**
	* @param ctx - host context owning this service's lifetime.
	*/
	constructor(ctx) {
		super(ctx, "checkSkillsHealth");
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
	/** Record one session log read.
	* @param decoded - whether the log could be decoded. */
	recordSessionRead(decoded) {
		this.sessionsRead += 1;
		if (!decoded) this.decodeFailures += 1;
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
			sessionsRead: this.sessionsRead,
			decodeFailures: this.decodeFailures
		});
	}
};
//#endregion
//#region packages/check-skills/src/index.ts
const name = "tool-check-skills";
/** The host service this package registers into. */
const inject = ["tools"];
/**
* Model-facing tool description. States what it does and when to reach for it,
* and deliberately stops there: usage instructions would be paid for on every
* request, and a failed call already returns `status: "error"` with a `code`,
* so the failure modes do not need to be described here.
*/
const TOOL_DESCRIPTION = "Audit a session log for whether the expected skills were loaded before the work started, and why not when they were not.";
/**
* Turn a thrown reader code into the tool's error shape, so an unsupported Node
* build or a missing session is a readable answer rather than a stack trace.
* @param error - Whatever the audit threw.
* @param sessionPath - Path being audited, when known.
* @returns A typed failure result.
*/
function toFailure(error, sessionPath) {
	if (error instanceof SessionReadError) return {
		status: "error",
		code: error.code,
		message: error.message,
		...error.sessionPath === void 0 ? {} : { sessionPath: error.sessionPath }
	};
	return {
		status: "error",
		code: "session_unreadable",
		message: error instanceof Error ? error.message : String(error),
		...sessionPath === void 0 ? {} : { sessionPath }
	};
}
/**
* Run one audit. Exported so tests can drive the real path without the registry.
* @param options - Session path, expectation list and optional evidence directory.
* @returns The audit result, or a typed failure.
*/
function runCheckSkills(options) {
	const applicableSkills = normalizeApplicableSkills(options.applicableSkills ?? []);
	let analysis;
	try {
		analysis = loadSession(options.sessionPath);
	} catch (error) {
		return toFailure(error, options.sessionPath);
	}
	const evidence = collectSkillUsage(analysis);
	const classification = classifySession({
		catalog: evidence.catalog,
		loads: evidence.loads,
		applicableSkills
	});
	const catalog = summarizeCatalog(evidence);
	const evidenceDir = options.evidenceDir?.trim();
	let evidencePath;
	let evidenceError;
	if (evidenceDir !== void 0 && evidenceDir !== "") {
		const recordedAt = (/* @__PURE__ */ new Date()).toISOString();
		try {
			evidencePath = writeEvidenceReport(evidenceDir, recordedAt, renderEvidenceReport({
				sessionPath: analysis.sessionPath,
				applicableSkills,
				verdict: classification.verdict,
				perSkill: classification.perSkill,
				catalog,
				calls: evidence.loads,
				missing: classification.missing,
				recordedAt
			}));
		} catch (error) {
			evidenceError = error instanceof Error ? error.message : String(error);
		}
	}
	return {
		status: "ok",
		task: {
			applicableSkills,
			source: applicableSkills.length === 0 ? "none" : "argument"
		},
		catalog,
		calls: evidence.loads,
		verdict: classification.verdict,
		missing: classification.missing,
		sessionPath: analysis.sessionPath,
		...evidencePath === void 0 ? {} : { evidencePath },
		...evidenceError === void 0 ? {} : { evidenceError }
	};
}
function apply(ctx) {
	const health = new SkillsHealth(ctx);
	ctx.tools.register(defineTool({
		name: "check_skills",
		description: TOOL_DESCRIPTION,
		parameters: {
			sessionPath: {
				type: "string",
				description: "Session log path; default: newest under $DSH_HOME/sessions"
			},
			applicableSkills: {
				type: "array",
				items: { type: "string" },
				description: "Skill names expected for this task"
			},
			evidenceDir: {
				type: "string",
				description: "Directory for the optional markdown report"
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
					code: { type: "string" },
					message: { type: "string" },
					verdict: { type: "string" },
					sessionPath: { type: "string" },
					evidencePath: { type: "string" },
					evidenceError: { type: "string" },
					missing: {
						type: "array",
						items: { type: "string" }
					},
					task: {
						type: "object",
						additionalProperties: false,
						properties: {
							applicableSkills: {
								type: "array",
								items: { type: "string" }
							},
							source: { type: "string" }
						}
					},
					catalog: {
						type: "object",
						additionalProperties: false,
						properties: {
							count: { type: "integer" },
							names: {
								type: "array",
								items: { type: "string" }
							},
							present: { type: "boolean" },
							called: {
								type: "array",
								items: { type: "string" }
							}
						}
					},
					calls: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								name: { type: "string" },
								turn: { type: "integer" },
								step: { type: "integer" },
								seq: { type: "integer" },
								ok: { type: "boolean" },
								reason: { type: "string" },
								error: { type: "string" },
								usedAfterLoad: { type: "boolean" }
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		async execute(args) {
			const report = await runCheckSkills({
				...args.sessionPath === void 0 ? {} : { sessionPath: args.sessionPath },
				...args.applicableSkills === void 0 ? {} : { applicableSkills: args.applicableSkills },
				...args.evidenceDir === void 0 ? {} : { evidenceDir: args.evidenceDir }
			});
			health.record(report.status !== "ok");
			health.recordSessionRead(report.status === "ok");
			return report;
		}
	}));
}
//#endregion
export { apply, inject, name, runCheckSkills };
