import { defineTool } from "@deepseek-ai/dsh-tools";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Service } from "@deepseek-ai/cordis";
//#region packages/check-quality-gates/src/shared/types.ts
/**
* Public types and contract constants of the gate core. Kept free of any DSH
* import so the core can be reused by another host wrapper (an MCP server, for
* example) without dragging the harness types along.
*/
/**
* Config file this tool looks for, relative to a directory. Resolution walks up
* from the working directory, so a caller keeps the config next to the workspace
* it describes.
*/
const GATE_CONFIG_FILE_NAME = ".dsh/gates.yml";
/**
* `source` value when no config file could be used. Spelled with angle brackets
* so it can never collide with a real path.
*/
const GATE_CONFIG_NOT_FOUND = "<not found>";
//#endregion
//#region packages/check-quality-gates/src/host/glob.ts
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
/** Characters that carry a meaning in a regular expression. */
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;
/**
* Canonical form a caller-supplied path or pattern is matched in: `/` separators,
* no leading `./`, no repeated separators, no surrounding whitespace.
* @param input - Path or pattern, however the caller spelled it.
* @returns The normalized form.
*/
function normalizePath(input) {
	return input.trim().replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").replace(/\/{2,}/g, "/");
}
/**
* Compile one glob pattern into an anchored regular expression.
* @param pattern - Glob pattern, for example `src/**`.
* @returns A case-sensitive expression matching a whole normalized path.
*/
function globToRegExp(pattern) {
	const source = normalizePath(pattern);
	let expression = "^";
	for (let index = 0; index < source.length; index += 1) {
		const char = source.charAt(index);
		if (char === "*") {
			if (source.charAt(index + 1) === "*") {
				if (source.charAt(index + 2) === "/") {
					expression += "(?:[^/]*/)*";
					index += 2;
				} else {
					expression += ".*";
					index += 1;
				}
			} else expression += "[^/]*";
			continue;
		}
		expression += char === "?" ? "[^/]" : char.replace(REGEXP_SPECIALS, "\\$&");
	}
	return new RegExp(`${expression}$`);
}
/**
* Whether one changed path is selected by one glob pattern.
* @param path - Changed path, relative to the workspace the config describes.
* @param pattern - Glob pattern from `when.paths`.
* @returns True when the whole path matches.
*/
function matchesGlob(path, pattern) {
	return globToRegExp(pattern).test(normalizePath(path));
}
//#endregion
//#region packages/check-quality-gates/src/host/yaml.ts
/** Syntax failure in the supported subset, carrying the 1-based source line. */
var YamlError = class extends Error {
	/** 1-based line the failure was found on. */
	line;
	constructor(message, line) {
		super(`${message} (line ${line})`);
		this.name = "YamlError";
		this.line = line;
	}
};
/** Escape sequences this parser understands inside a double-quoted scalar. */
const DOUBLE_QUOTE_ESCAPES = {
	"\\": "\\",
	"\"": "\"",
	"/": "/",
	"0": "\0",
	n: "\n",
	r: "\r",
	t: "	"
};
/** Leading characters that mark YAML features outside the supported subset. */
const UNSUPPORTED_LEAD = /* @__PURE__ */ new Set([
	"&",
	"*",
	"!",
	"|",
	">",
	"%",
	"@",
	"`"
]);
/** Number shape accepted for a plain scalar. */
const NUMBER = /^-?\d+(?:\.\d+)?$/;
/** Cut a trailing comment, leaving any `#` inside quotes alone. */
function stripComment(line) {
	let quote;
	for (let index = 0; index < line.length; index += 1) {
		const char = line.charAt(index);
		if (quote !== void 0) {
			if (char === quote) quote = void 0;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			continue;
		}
		if (char === "#" && (index === 0 || /\s/.test(line.charAt(index - 1)))) return line.slice(0, index);
	}
	return line;
}
/** Measure leading indentation, rejecting tabs the way YAML does. */
function measureIndent(line, lineNumber) {
	let indent = 0;
	while (indent < line.length) {
		const char = line.charAt(indent);
		if (char !== " " && char !== "	") break;
		if (char === "	") throw new YamlError("tab characters are not allowed in indentation", lineNumber);
		indent += 1;
	}
	return indent;
}
/** Drop comments and blank lines, and measure what remains. */
function scanLines(text) {
	const lines = [];
	const raw = text.split(/\r?\n/);
	for (let index = 0; index < raw.length; index += 1) {
		const lineNumber = index + 1;
		const content = stripComment(raw[index] ?? "").replace(/\s+$/, "");
		if (content.trim() === "") continue;
		const indent = measureIndent(content, lineNumber);
		lines.push({
			number: lineNumber,
			indent,
			content: content.slice(indent)
		});
	}
	return lines;
}
/** Whether one line opens a block sequence item. */
function isSequenceEntry(content) {
	return content === "-" || content.startsWith("- ");
}
/** Read a quoted scalar, insisting that the closing quote ends the text. */
function readQuoted(text, line) {
	if (text.charAt(0) === "'") {
		let value = "";
		for (let index = 1; index < text.length; index += 1) {
			const char = text.charAt(index);
			if (char !== "'") {
				value += char;
				continue;
			}
			if (text.charAt(index + 1) === "'") {
				value += "'";
				index += 1;
				continue;
			}
			if (text.slice(index + 1).trim() !== "") throw new YamlError("unexpected content after a quoted scalar", line);
			return value;
		}
		throw new YamlError("unterminated single-quoted string", line);
	}
	let value = "";
	for (let index = 1; index < text.length; index += 1) {
		const char = text.charAt(index);
		if (char === "\\") {
			const escape = text.charAt(index + 1);
			const replacement = DOUBLE_QUOTE_ESCAPES[escape];
			if (escape === "" || replacement === void 0) throw new YamlError(`unsupported escape sequence "\\${escape}"`, line);
			value += replacement;
			index += 1;
			continue;
		}
		if (char === "\"") {
			if (text.slice(index + 1).trim() !== "") throw new YamlError("unexpected content after a quoted scalar", line);
			return value;
		}
		value += char;
	}
	throw new YamlError("unterminated double-quoted string", line);
}
/** Read one plain or quoted scalar value. */
function readScalar(text, line) {
	if (text === "") return null;
	const first = text.charAt(0);
	if (first === "\"" || first === "'") return readQuoted(text, line);
	if (text === "~" || text === "null") return null;
	if (text === "true") return true;
	if (text === "false") return false;
	if (UNSUPPORTED_LEAD.has(first)) throw new YamlError(`unsupported scalar syntax "${text}"`, line);
	return NUMBER.test(text) ? Number(text) : text;
}
/** Read one item of a flow sequence. */
function readFlowItem(text, line) {
	const trimmed = text.trim();
	if (trimmed === "") throw new YamlError("empty item in a flow sequence", line);
	return readScalar(trimmed, line);
}
/** Read a flow sequence of scalars. */
function readFlowSequence(text, line) {
	if (!text.endsWith("]")) throw new YamlError("unterminated flow sequence; expected \"]\"", line);
	const inner = text.slice(1, -1);
	if (inner.trim() === "") return [];
	const items = [];
	let quote;
	let current = "";
	for (let index = 0; index < inner.length; index += 1) {
		const char = inner.charAt(index);
		if (quote !== void 0) {
			current += char;
			if (char === quote) quote = void 0;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === "[" || char === "{") throw new YamlError("nested flow collections are not supported", line);
		if (char === "]") throw new YamlError("unexpected \"]\" inside a flow sequence", line);
		if (char === ",") {
			items.push(readFlowItem(current, line));
			current = "";
			continue;
		}
		current += char;
	}
	if (quote !== void 0) throw new YamlError("unterminated quoted string in a flow sequence", line);
	items.push(readFlowItem(current, line));
	return items;
}
/** Read one inline value: a flow sequence or a scalar. */
function readValue(text, line) {
	const trimmed = text.trim();
	if (trimmed.startsWith("[")) return readFlowSequence(trimmed, line);
	if (trimmed.startsWith("{")) throw new YamlError("flow mappings are not supported; use block style", line);
	if (trimmed.startsWith("|") || trimmed.startsWith(">")) throw new YamlError("block scalars are not supported", line);
	if (trimmed.startsWith("&") || trimmed.startsWith("*")) throw new YamlError("anchors and aliases are not supported", line);
	if (trimmed.startsWith("!")) throw new YamlError("tags are not supported", line);
	if (trimmed.startsWith("%")) throw new YamlError("directives are not supported", line);
	return readScalar(trimmed, line);
}
/** Split one `key: value` text, or return undefined when it is a plain value. */
function splitEntry(text, line) {
	let quote;
	for (let index = 0; index < text.length; index += 1) {
		const char = text.charAt(index);
		if (quote !== void 0) {
			if (char === quote) quote = void 0;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[" || char === "{") return void 0;
		if (char !== ":") continue;
		const next = text.charAt(index + 1);
		if (next !== "" && next !== " ") continue;
		const rawKey = text.slice(0, index).trim();
		if (rawKey === "") throw new YamlError("empty key", line);
		const key = rawKey.startsWith("\"") || rawKey.startsWith("'") ? readQuoted(rawKey, line) : rawKey;
		const value = text.slice(index + 1).trim();
		return {
			key,
			value: value === "" ? void 0 : value
		};
	}
}
/** Reads one document, one indentation level at a time. */
var DocumentReader = class {
	index = 0;
	lines;
	constructor(lines) {
		this.lines = lines;
	}
	/** Read the whole document; trailing lines are a syntax error. */
	read() {
		const first = this.peek();
		if (first === void 0) return null;
		if (first.indent === 0 && first.content === "---") this.index += 1;
		const start = this.peek();
		if (start === void 0) return null;
		const value = this.readNode(start.indent);
		const trailing = this.peek();
		if (trailing !== void 0) throw new YamlError(trailing.indent > start.indent ? "unexpected indentation" : "unexpected content after the document root", trailing.number);
		return value;
	}
	peek() {
		return this.lines[this.index];
	}
	/** Read a nested block below `indent`, or null when there is none. */
	readValueBelow(indent) {
		const next = this.peek();
		return next !== void 0 && next.indent > indent ? this.readNode(next.indent) : null;
	}
	readNode(indent) {
		const line = this.peek();
		if (line === void 0 || line.indent < indent) return null;
		return isSequenceEntry(line.content) ? this.readSequence(line.indent) : this.readMapping(line.indent);
	}
	readMapping(indent) {
		return Object.fromEntries(this.readMappingEntries(/* @__PURE__ */ new Map(), indent));
	}
	readMappingEntries(mapping, indent) {
		for (;;) {
			const line = this.peek();
			if (line === void 0 || line.indent < indent) return mapping;
			if (line.indent > indent) throw new YamlError("unexpected indentation", line.number);
			if (isSequenceEntry(line.content)) return mapping;
			const entry = splitEntry(line.content, line.number);
			if (entry === void 0) throw new YamlError("expected a \"key: value\" pair", line.number);
			if (mapping.has(entry.key)) throw new YamlError(`duplicate key "${entry.key}"`, line.number);
			this.index += 1;
			mapping.set(entry.key, entry.value === void 0 ? this.readValueBelow(indent) : readValue(entry.value, line.number));
		}
	}
	readSequence(indent) {
		const items = [];
		for (;;) {
			const line = this.peek();
			if (line === void 0 || line.indent < indent) return items;
			if (line.indent > indent) throw new YamlError("unexpected indentation", line.number);
			if (!isSequenceEntry(line.content)) return items;
			this.index += 1;
			const rest = line.content.slice(1);
			const item = rest.trim();
			if (item === "") {
				items.push(this.readValueBelow(indent));
				continue;
			}
			const itemIndent = indent + 1 + (rest.length - rest.trimStart().length);
			const entry = splitEntry(item, line.number);
			if (entry === void 0) {
				items.push(readValue(item, line.number));
				continue;
			}
			const mapping = /* @__PURE__ */ new Map();
			mapping.set(entry.key, entry.value === void 0 ? this.readValueBelow(itemIndent) : readValue(entry.value, line.number));
			this.readMappingEntries(mapping, itemIndent);
			items.push(Object.fromEntries(mapping));
		}
	}
};
/**
* Parse the supported YAML subset.
* @param text - Config file contents.
* @returns The parsed document; an empty document is `null`.
* @throws YamlError When the text uses syntax outside the supported subset.
*/
function parseYamlSubset(text) {
	return new DocumentReader(scanLines(text)).read();
}
//#endregion
//#region packages/check-quality-gates/src/host/gates.ts
/**
* Gate core: parse the caller's config, match changed files against every gate,
* and assemble the report. Pure functions only — no filesystem, no host import,
* so every rule here is testable without touching a disk or a harness.
*
* The package ships no gate of its own. A gate exists only because the caller
* declared it in `.dsh/gates.yml`; nothing about a project's scripts, paths, or
* evidence format is built in.
*/
/** Keys a gate entry may carry. Anything else is a typo and is rejected. */
const GATE_KEYS = [
	"id",
	"command",
	"reason",
	"rawEvidenceRequired",
	"when"
];
/** Keys the `when` block may carry. */
const WHEN_KEYS = ["paths"];
/** Keys the document root may carry. */
const ROOT_KEYS = ["gates"];
/**
* A config file that could not be used. Carries the source line when the
* failure is syntactic; the message is written to be pasted into a report.
*/
var GateConfigError = class extends Error {
	/** 1-based config line, when the failure has one. */
	line;
	constructor(message, line) {
		super(message);
		this.name = "GateConfigError";
		this.line = line;
	}
};
/** Whether one value is a mapping (not null, not an array, not a scalar). */
function isMapping(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Require a mapping, with a readable scope-qualified message. */
function requireMapping(value, scope) {
	if (value === void 0) throw new GateConfigError(`${scope}: missing required key`);
	if (!isMapping(value)) throw new GateConfigError(`${scope}: expected a mapping`);
	return value;
}
/** Reject keys outside the documented schema, so a typo cannot pass silently. */
function assertKnownKeys(mapping, allowed, scope) {
	for (const key of Object.keys(mapping)) if (!allowed.includes(key)) throw new GateConfigError(`${scope}: unknown key "${key}" (allowed: ${allowed.join(", ")})`);
}
/** Require a non-empty string field. */
function requireString(mapping, key, scope) {
	const value = mapping[key];
	if (value === void 0 || value === null) throw new GateConfigError(`${scope}: missing required key "${key}"`);
	if (typeof value !== "string" || value.trim() === "") throw new GateConfigError(`${scope}.${key}: must be a non-empty string`);
	return value.trim();
}
/** Validate one gate entry. */
function parseGate(entry, scope) {
	const gate = requireMapping(entry, `${scope}`);
	assertKnownKeys(gate, GATE_KEYS, scope);
	const id = requireString(gate, "id", scope);
	const command = requireString(gate, "command", scope);
	const reason = requireString(gate, "reason", scope);
	const rawEvidenceRequired = requireString(gate, "rawEvidenceRequired", scope);
	const when = gate["when"];
	if (when === void 0) throw new GateConfigError(`${scope}: missing required key "when"`);
	const whenMapping = requireMapping(when, `${scope}.when`);
	assertKnownKeys(whenMapping, WHEN_KEYS, `${scope}.when`);
	const rawPaths = whenMapping["paths"];
	if (rawPaths === void 0 || rawPaths === null) throw new GateConfigError(`${scope}.when: missing required key "paths"`);
	if (!Array.isArray(rawPaths) || rawPaths.length === 0) throw new GateConfigError(`${scope}.when.paths: must be a non-empty list of glob strings`);
	return {
		id,
		command,
		reason,
		rawEvidenceRequired,
		paths: rawPaths.map((pattern, index) => {
			if (typeof pattern !== "string" || pattern.trim() === "") throw new GateConfigError(`${scope}.when.paths[${index}]: must be a non-empty glob string`);
			return pattern.trim();
		})
	};
}
/**
* Parse and validate a gate config.
* @param text - Config file contents.
* @returns The declared gates, in the order they appear in the file.
* @throws GateConfigError On a syntax error outside the supported YAML subset, a
* missing or mistyped field, an unknown key, or a duplicate gate id.
*/
function parseGateConfig(text) {
	let document;
	try {
		document = parseYamlSubset(text);
	} catch (error) {
		if (error instanceof YamlError) throw new GateConfigError(error.message, error.line);
		throw error;
	}
	const root = requireMapping(document, "config root");
	assertKnownKeys(root, ROOT_KEYS, "config root");
	if (!("gates" in root)) throw new GateConfigError("config root: missing required key \"gates\"");
	const rawGates = root["gates"];
	if (rawGates === null) return [];
	if (!Array.isArray(rawGates)) throw new GateConfigError("config root: \"gates\" must be a list of gate mappings");
	const gates = rawGates.map((entry, index) => parseGate(entry, `gates[${index}]`));
	const seen = /* @__PURE__ */ new Map();
	for (const [index, gate] of gates.entries()) {
		const first = seen.get(gate.id);
		if (first !== void 0) throw new GateConfigError(`duplicate gate id "${gate.id}" (gates[${first}] and gates[${index}])`);
		seen.set(gate.id, index);
	}
	return gates;
}
/**
* Normalize the caller's changed-file list: trimmed, `\` separators folded to
* `/`, blanks dropped, duplicates removed, sorted for a stable report.
* @param files - Files the caller says this task changed.
* @returns The canonical list every other function here works on.
*/
function normalizeChangedFiles(files) {
	const unique = /* @__PURE__ */ new Set();
	for (const file of files) {
		const normalized = normalizePath(file);
		if (normalized !== "") unique.add(normalized);
	}
	return [...unique].toSorted();
}
/** Whether one changed file is selected by any pattern of one gate. */
function gateSelects(gate, file) {
	return gate.paths.some((pattern) => matchesGlob(file, pattern));
}
/**
* Select the gates at least one changed file requires.
*
* Order is the config order, which makes the report stable across runs and
* independent of the order the caller listed its files in. A gate matched by
* several files appears once.
* @param changedFiles - Normalized changed files.
* @param gates - Declared gates, in config order.
* @returns One entry per required gate.
*/
function selectRequiredGates(changedFiles, gates) {
	const required = [];
	for (const gate of gates) {
		if (!changedFiles.some((file) => gateSelects(gate, file))) continue;
		required.push({
			id: gate.id,
			command: gate.command,
			reason: gate.reason,
			rawEvidenceRequired: gate.rawEvidenceRequired
		});
	}
	return required;
}
/**
* Select the changed files no gate selected. Reported instead of dropped, so an
* unconfigured area of the workspace is visible rather than silently ungated.
* @param changedFiles - Normalized changed files.
* @param gates - Declared gates.
* @returns The unmatched files, deduplicated and sorted.
*/
function selectUnmatchedFiles(changedFiles, gates) {
	return changedFiles.filter((file) => !gates.some((gate) => gateSelects(gate, file)));
}
/**
* Assemble the complete report.
* @param input - Changed files, the config source, the parsed gates, and an
* optional error. When `error` is set, no gate list is produced and every
* changed file is reported as unmatched instead of being dropped.
* @returns The report, always with `enforcement: "none"`.
*/
function buildGateReport(input) {
	const changedFiles = normalizeChangedFiles(input.changedFiles);
	const error = input.error ?? null;
	if (error !== null) return {
		changedFiles,
		requiredGates: [],
		source: input.source,
		enforcement: "none",
		unmatched: [...changedFiles],
		error,
		code: input.code ?? "config_invalid"
	};
	const gates = input.gates ?? [];
	return {
		changedFiles,
		requiredGates: selectRequiredGates(changedFiles, gates),
		source: input.source,
		enforcement: "none",
		unmatched: selectUnmatchedFiles(changedFiles, gates),
		error: null,
		code: null
	};
}
/**
* Readable explanation for a config file that could not be found.
* @param searched - Directory the upward search started from.
* @returns One sentence naming the file and the search start.
*/
function gateConfigNotFoundMessage(searched) {
	return `No gate config found: no ${GATE_CONFIG_FILE_NAME} in ${searched} or any parent directory.`;
}
//#endregion
//#region packages/check-quality-gates/src/host/config-file.ts
/**
* Config lookup half of the gate core: find the caller's config file, read it,
* and turn any failure into a readable report instead of an exception.
*
* This is the only module in the package that touches the filesystem. The rules
* it implements are deliberately small: an explicit `configPath` wins, otherwise
* the search walks up from the working directory to the filesystem root looking
* for `.dsh/gates.yml`.
*/
/** Whether one path exists and is a regular file. */
function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
/** One-sentence reason from an unknown thrown value. */
function reason(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Find the nearest config file at or above `startDir`.
* @param startDir - Directory the search starts from.
* @returns The absolute path, or undefined when no parent holds one.
*/
function findGateConfigPath(startDir) {
	let directory = resolve(startDir);
	for (;;) {
		const candidate = join(directory, GATE_CONFIG_FILE_NAME);
		if (isFile(candidate)) return candidate;
		const parent = dirname(directory);
		if (parent === directory) return void 0;
		directory = parent;
	}
}
/**
* Produce the report for one call. Never throws: a missing, unreadable, or
* invalid config yields a readable `error` and an empty gate list, with every
* changed file reported as unmatched.
* @param input - Changed files, an optional explicit config path, and an
* optional working directory (defaults to the host process's directory).
* @returns The complete report.
*/
function resolveGateReport(input) {
	const cwd = resolve(input.cwd ?? process.cwd());
	const explicit = input.configPath?.trim();
	const source = (explicit === void 0 || explicit === "" ? void 0 : resolve(cwd, explicit)) ?? findGateConfigPath(cwd);
	if (source === void 0) return buildGateReport({
		changedFiles: input.changedFiles,
		source: GATE_CONFIG_NOT_FOUND,
		error: gateConfigNotFoundMessage(cwd),
		code: "config_not_found"
	});
	if (!isFile(source)) return buildGateReport({
		changedFiles: input.changedFiles,
		source: GATE_CONFIG_NOT_FOUND,
		error: `No gate config found at ${source}.`,
		code: "config_not_found"
	});
	let text;
	try {
		text = readFileSync(source, "utf8");
	} catch (error) {
		return buildGateReport({
			changedFiles: input.changedFiles,
			source,
			error: `Could not read gate config at ${source}: ${reason(error)}.`,
			code: "config_unreadable"
		});
	}
	try {
		return buildGateReport({
			changedFiles: input.changedFiles,
			source,
			gates: parseGateConfig(text)
		});
	} catch (error) {
		const detail = error instanceof GateConfigError ? error.message : reason(error);
		return buildGateReport({
			changedFiles: input.changedFiles,
			source,
			error: `Invalid gate config at ${source}: ${detail}.`,
			code: "config_invalid"
		});
	}
}
//#endregion
//#region packages/check-quality-gates/src/host/health.ts
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
var QualityGatesHealth = class extends Service {
	calls = 0;
	failures = 0;
	lastCallAt = null;
	lastFailureAt = null;
	configErrors = 0;
	/**
	* @param ctx - host context owning this service's lifetime.
	*/
	constructor(ctx) {
		super(ctx, "checkQualityGatesHealth");
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
	/** Record one call that failed on its configuration rather than on its input. */
	recordConfigError() {
		this.configErrors += 1;
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
			configErrors: this.configErrors
		});
	}
};
//#endregion
//#region packages/check-quality-gates/src/index.ts
const name = "tool-check-quality-gates";
/**
* Only the tool registry is used. This package registers **no** system-prompt
* section: the gate list is an on-demand lookup, not a rule worth paying for on
* every request, so its resident prompt cost is zero.
*/
const inject = ["tools"];
/**
* Model-facing tool description: what it does, when to reach for it, and the
* fact that it only reports. Usage detail and failure behavior stay out — the
* model reads the parameter schema and the returned `error` field instead.
*/
const TOOL_DESCRIPTION = "Map the files changed in a task to the quality gates the caller's config requires, with the raw evidence each gate must return. Report only: enforcement is \"none\", so an unrun gate is never blocked.";
function apply(ctx) {
	const health = new QualityGatesHealth(ctx);
	ctx.tools.register(defineTool({
		name: "check_quality_gates",
		description: TOOL_DESCRIPTION,
		parameters: {
			changedFiles: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "Files changed in this task"
			},
			configPath: {
				type: "string",
				description: "Gate config path (default: nearest .dsh/gates.yml)"
			},
			cwd: {
				type: "string",
				description: "Working directory"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					changedFiles: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					requiredGates: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: {
									type: "string",
									required: true
								},
								command: {
									type: "string",
									required: true
								},
								reason: {
									type: "string",
									required: true
								},
								rawEvidenceRequired: {
									type: "string",
									required: true
								}
							}
						}
					},
					source: {
						type: "string",
						required: true
					},
					enforcement: {
						type: "string",
						required: true,
						const: "none"
					},
					unmatched: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					error: {
						oneOf: [{ type: "string" }, { type: "null" }],
						required: true
					},
					code: {
						oneOf: [{
							type: "string",
							enum: [
								"config_not_found",
								"config_unreadable",
								"config_invalid"
							]
						}, { type: "null" }],
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args) {
			const report = await resolveGateReport({
				changedFiles: args.changedFiles,
				configPath: args.configPath,
				cwd: args.cwd
			});
			health.record(report.error !== null);
			if (report.error !== null) health.recordConfigError();
			return report;
		}
	}));
}
//#endregion
export { apply, inject, name };
