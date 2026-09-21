import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
//#region packages/safe-tool-call-policy/src/host/call-shape.ts
/** The one argument each understood tool is read from, paired with its shape. */
const COMMAND_ARGUMENT = { bash: "command" };
/** Tools whose target path is the matchable text, prefixed by the tool name as the write verb. */
const PATH_TOOLS = /* @__PURE__ */ new Set(["write", "edit"]);
/** Read one own string field from arguments that may be anything at all. */
function stringField$1(args, key) {
	if (typeof args !== "object" || args === null) return "";
	const value = args[key];
	return typeof value === "string" ? value : "";
}
/**
* Reduce a pending call to `{ tool, text }`.
*
* @param tool - tool name as the harness knows it (`exec.name`).
* @param args - the call's parsed arguments (`exec.arguments`).
* @returns the matchable shape. Unknown tools, and understood tools called
*   without their identifying argument, yield an empty text that matches no
*   shipped rule; a `*` rule written for such a tool can only match on an
*   explicit empty-text pattern, which no shipped rule uses.
*/
function callShapeOf(tool, args) {
	const commandArgument = COMMAND_ARGUMENT[tool];
	if (commandArgument !== void 0) return {
		tool,
		text: stringField$1(args, commandArgument)
	};
	if (PATH_TOOLS.has(tool)) {
		const path = stringField$1(args, "file_path");
		return {
			tool,
			text: path.length === 0 ? "" : `${tool} ${path}`
		};
	}
	return {
		tool,
		text: ""
	};
}
//#endregion
//#region packages/safe-tool-call-policy/src/host/config-error.ts
/**
* Raised when a project policy document cannot be used at all: unreadable
* syntax, an unknown top-level shape, or a value the reader refuses to guess
* at. The caller turns this into a fail-open decision plus a note, so throwing
* it never blocks a call — it only says "this file cannot be trusted".
*/
var PolicyConfigError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "PolicyConfigError";
	}
};
//#endregion
//#region packages/safe-tool-call-policy/src/host/yaml-subset.ts
/**
* A deliberately small YAML reader for the project policy document.
*
* A full YAML parser is a dependency this package does not need: the policy
* document has exactly one shape, so the reader implements exactly that shape
* and refuses everything else by throwing {@link PolicyConfigError} — and a
* refused document fails open with a note instead of half-applying.
*
* Supported:
*
* ```yaml
* # full-line comment
* disable:                 # a block sequence of scalars
*   - rule-id
*   - other-rule-id
* rules:                   # a block sequence of flat mappings
*   - id: my-rule
*     tool: bash
*     pattern: "psql .*prod"   # plain, 'single', or "double" quoted scalar
*     action: ask
*     reason: Touches production.
*     remedy: Use the staging DSN.
*     source: project
* ```
*
* Also accepted: blank lines, trailing `# comment` after whitespace outside
* quotes, one level of `- ` nesting as above, and a flow sequence written as
* JSON (`disable: ["a", "b"]`) or as a bare comma list (`disable: [a, b]`).
*
* Refused on purpose: tabs in indentation, nested mappings other than the one
* `rules:` item level, block scalars (`|`, `>`), anchors and aliases (`&`, `*`),
* tags (`!`), multiple documents (`---`), and duplicate keys. JSON is a subset
* of this grammar, so a JSON policy body parses here too.
*
* @module safe-tool-call-policy/yaml-subset
*/
/** Keys of the policy document; anything else is reported, not guessed. */
const TOP_LEVEL_KEYS = /* @__PURE__ */ new Set(["rules", "disable"]);
/** Plain scalars may not begin with a YAML indicator this reader does not implement. */
const UNSUPPORTED_SCALAR_START = /* @__PURE__ */ new Set([
	"&",
	"*",
	"!",
	"|",
	">",
	"{",
	"}",
	"%",
	"@",
	"`"
]);
/** A key this reader accepts: simple, unquoted, no spaces. */
const KEY_PATTERN = /^[A-Za-z_][\w-]*$/;
/** Whether one line starts a `- ` sequence item. */
function isSequenceItem(text) {
	return text === "-" || text.startsWith("- ");
}
/** Remove a trailing `# comment` that starts outside quotes and after whitespace. */
function stripComment(line) {
	let quote;
	for (let index = 0; index < line.length; index++) {
		const character = line[index];
		if (quote === "\"") {
			if (character === "\\") index++;
			else if (character === "\"") quote = void 0;
			continue;
		}
		if (quote === "'") {
			if (character !== "'") continue;
			if (line[index + 1] === "'") index++;
			else quote = void 0;
			continue;
		}
		if (character === "\"" || character === "'") {
			quote = character;
			continue;
		}
		if (character === "#" && (index === 0 || /\s/.test(line[index - 1] ?? ""))) return line.slice(0, index);
	}
	return line;
}
/** Split the document into significant lines, rejecting tab indentation. */
function readSignificantLines(text) {
	const lines = [];
	const raw = text.split("\n");
	for (const [index, rawLine] of raw.entries()) {
		const line = stripComment(rawLine.replace(/\r$/, ""));
		const content = line.trimStart();
		const indent = line.length - content.length;
		if (content.length === 0) continue;
		if (line.slice(0, indent).includes("	")) throw new PolicyConfigError(`line ${index + 1}: tab in indentation; use spaces`);
		lines.push({
			number: index + 1,
			indent,
			text: content
		});
	}
	return lines;
}
/** Read a quoted or plain scalar, or a flow sequence, from one value fragment. */
function parseValue(fragment, line) {
	const value = fragment.trim();
	if (value.length === 0) throw new PolicyConfigError(`line ${line}: missing value`);
	if (value.startsWith("\"")) try {
		const parsed = JSON.parse(value);
		if (typeof parsed !== "string") throw new Error("not a string");
		return parsed;
	} catch {
		throw new PolicyConfigError(`line ${line}: invalid double-quoted string`);
	}
	if (value.startsWith("'")) {
		if (value.length < 2 || !value.endsWith("'")) throw new PolicyConfigError(`line ${line}: unterminated single-quoted string`);
		return value.slice(1, -1).replaceAll("''", "'");
	}
	if (value.startsWith("[")) {
		if (!value.endsWith("]")) throw new PolicyConfigError(`line ${line}: unterminated flow sequence`);
		const body = value.slice(1, -1).trim();
		if (body.length === 0) return [];
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
		} catch {}
		return body.split(",").map((item) => item.trim().replace(/^(['"])(.*)\1$/, "$2"));
	}
	if (UNSUPPORTED_SCALAR_START.has(value[0] ?? "")) throw new PolicyConfigError(`line ${line}: value starts with "${value[0]}", which this reader does not implement; quote the value`);
	if (value.includes(": ")) throw new PolicyConfigError(`line ${line}: plain value contains ": "; quote the value`);
	return value;
}
/** Split `key: value` at the first colon that ends the key, or return undefined. */
function splitKey(text) {
	const colon = text.indexOf(":");
	if (colon < 0) return void 0;
	const key = text.slice(0, colon);
	const rest = text.slice(colon + 1);
	if (!KEY_PATTERN.test(key)) return void 0;
	if (rest.length > 0 && !rest.startsWith(" ")) return void 0;
	return {
		key,
		value: rest.trim()
	};
}
/** Read one block sequence starting at `start`, returning its items and the next index. */
function parseBlockSequence(lines, start, ownerKey) {
	const items = [];
	let index = start;
	let itemIndent;
	while (index < lines.length) {
		const line = lines[index];
		if (line === void 0 || line.indent === 0) break;
		if (itemIndent === void 0) itemIndent = line.indent;
		if (line.indent !== itemIndent) throw new PolicyConfigError(`line ${line.number}: sequence item under "${ownerKey}" is indented differently from the first item`);
		if (!isSequenceItem(line.text)) throw new PolicyConfigError(`line ${line.number}: expected a "- " sequence item under "${ownerKey}"`);
		const itemText = line.text === "-" ? "" : line.text.slice(2);
		const head = splitKey(itemText);
		if (head === void 0) {
			if (itemText.trim().length === 0) throw new PolicyConfigError(`line ${line.number}: empty sequence item under "${ownerKey}"`);
			items.push(parseValue(itemText, line.number));
			index++;
			const next = lines[index];
			if (next !== void 0 && next.indent > (itemIndent ?? 0) && !isSequenceItem(next.text)) throw new PolicyConfigError(`line ${next.number}: a scalar sequence item under "${ownerKey}" cannot have nested content`);
			continue;
		}
		const keyColumn = (itemIndent ?? 0) + 2;
		const item = {};
		let cursor = line;
		let cursorIndex = index;
		let first = true;
		while (cursor !== void 0) {
			const entry = first ? head : splitKey(cursor.text);
			if (entry === void 0) throw new PolicyConfigError(`line ${cursor.number}: expected "key: value" in a "${ownerKey}" item`);
			if (Object.hasOwn(item, entry.key)) throw new PolicyConfigError(`line ${cursor.number}: duplicate key "${entry.key}"`);
			item[entry.key] = parseValue(entry.value, cursor.number);
			cursorIndex++;
			cursor = lines[cursorIndex];
			first = false;
			if (cursor === void 0 || cursor.indent !== keyColumn) break;
			if (isSequenceItem(cursor.text)) throw new PolicyConfigError(`line ${cursor.number}: unexpected sequence item inside a mapping item`);
		}
		items.push(item);
		index = cursorIndex;
	}
	return {
		items,
		next: index
	};
}
/**
* Parse the policy document subset.
*
* @param text - the raw file content.
* @returns one object per top-level key; keys outside `rules`/`disable` are
*   still returned so the caller can report them.
* @throws {PolicyConfigError} when the text is not inside the supported subset.
*/
function parseYamlSubset(text) {
	const lines = readSignificantLines(text);
	const document = {};
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line === void 0) break;
		if (line.indent !== 0) throw new PolicyConfigError(`line ${line.number}: unexpected indentation at the top level`);
		const entry = splitKey(line.text);
		if (entry === void 0) throw new PolicyConfigError(`line ${line.number}: expected "key: value" at the top level`);
		if (Object.hasOwn(document, entry.key)) throw new PolicyConfigError(`line ${line.number}: duplicate key "${entry.key}"`);
		if (entry.value.length > 0) {
			if (entry.value === "|" || entry.value === ">") throw new PolicyConfigError(`line ${line.number}: block scalars are not supported; quote the value`);
			document[entry.key] = parseValue(entry.value, line.number);
			index++;
			continue;
		}
		const sequence = parseBlockSequence(lines, index + 1, entry.key);
		if (sequence.items.length === 0) throw new PolicyConfigError(`line ${line.number}: "${entry.key}" has no value and no block sequence`);
		document[entry.key] = sequence.items;
		index = sequence.next;
	}
	return document;
}
//#endregion
//#region packages/safe-tool-call-policy/src/host/policy-document.ts
/** Rule id shape: kebab-case, which is also what a `disable` entry must name. */
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Tool selectors a rule may declare. */
const TOOL_SELECTORS = /* @__PURE__ */ new Set([
	"bash",
	"write",
	"edit",
	"*"
]);
/** Actions an entry may declare; `allow` retires an existing rule. */
const ACTIONS = /* @__PURE__ */ new Set([
	"allow",
	"ask",
	"deny"
]);
/** Fields of a rule entry; anything else is reported rather than ignored silently. */
const RULE_FIELDS = /* @__PURE__ */ new Set([
	"id",
	"tool",
	"pattern",
	"action",
	"reason",
	"remedy",
	"source"
]);
/** Narrowing helper for plain records. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read one own string field, trimmed; empty when absent or of another type. */
function stringField(record, key) {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}
/**
* Validate one rule entry (from the project document or from the shipped file).
*
* @param value - the raw entry.
* @param index - position in its list, used in notes.
* @param allowedActions - actions the source may use; the shipped file allows
*   only `ask` and `deny`, while a project document may also use `allow`.
* @returns the validated entry, or the note explaining why it was dropped.
*/
function validateRuleEntry(value, index, allowedActions = ACTIONS) {
	if (!isRecord(value)) return { error: `rules[${index}] is not a mapping and was skipped` };
	const id = stringField(value, "id");
	if (!RULE_ID_PATTERN.test(id)) return { error: `rules[${index}] has no usable id (expected kebab-case) and was skipped` };
	const notes = [];
	for (const key of Object.keys(value)) if (!RULE_FIELDS.has(key)) notes.push(`rule "${id}": unknown field "${key}" was ignored`);
	const actionField = stringField(value, "action");
	if (!ACTIONS.has(actionField) || !allowedActions.has(actionField)) return { error: `rule "${id}": action must be one of ${[...allowedActions].join("/")} and was skipped` };
	const action = actionField;
	if (action === "allow") return {
		rule: {
			id,
			tool: "*",
			pattern: "",
			action,
			reason: "",
			remedy: "",
			source: stringField(value, "source")
		},
		notes
	};
	const toolField = stringField(value, "tool");
	const tool = toolField.length === 0 ? "*" : toolField;
	if (!TOOL_SELECTORS.has(tool)) return { error: `rule "${id}": tool must be one of bash/write/edit/* and was skipped` };
	const pattern = stringField(value, "pattern");
	if (pattern.length === 0) return { error: `rule "${id}": pattern is required and was skipped` };
	try {
		RegExp(pattern);
	} catch {
		return { error: `rule "${id}": pattern is not a valid regular expression and was skipped` };
	}
	const reason = stringField(value, "reason");
	const remedy = stringField(value, "remedy");
	if (reason.length === 0) return { error: `rule "${id}": reason is required and was skipped` };
	if (remedy.length === 0) return { error: `rule "${id}": remedy is required and was skipped` };
	return {
		rule: {
			id,
			tool,
			pattern,
			action,
			reason,
			remedy,
			source: stringField(value, "source")
		},
		notes
	};
}
/** Turn a parsed value into a document, or throw when its shape is unusable. */
function documentFromValue(value, origin) {
	if (!isRecord(value)) throw new PolicyConfigError(`${origin}: the document must be a mapping with "rules" and/or "disable"`);
	const notes = [];
	const rules = [];
	const disable = [];
	for (const key of Object.keys(value)) if (!TOP_LEVEL_KEYS.has(key)) notes.push(`${origin}: unknown top-level key "${key}" was ignored`);
	const rawRules = value["rules"];
	if (rawRules !== void 0) {
		if (!Array.isArray(rawRules)) throw new PolicyConfigError(`${origin}: "rules" must be a list`);
		for (const [index, entry] of rawRules.entries()) {
			const result = validateRuleEntry(entry, index);
			if ("rule" in result) {
				rules.push(result.rule);
				for (const note of result.notes) notes.push(`${origin}: ${note}`);
			} else notes.push(`${origin}: ${result.error}`);
		}
	}
	const rawDisable = value["disable"];
	if (rawDisable !== void 0) {
		if (!Array.isArray(rawDisable)) throw new PolicyConfigError(`${origin}: "disable" must be a list`);
		for (const [index, entry] of rawDisable.entries()) {
			if (typeof entry !== "string" || !RULE_ID_PATTERN.test(entry.trim())) {
				notes.push(`${origin}: disable[${index}] is not a rule id and was skipped`);
				continue;
			}
			disable.push(entry.trim());
		}
	}
	return {
		rules,
		disable,
		notes
	};
}
/**
* Parse and validate a project policy document.
*
* @param text - raw file content.
* @param format - `json` for a `.json` file, `yaml` for a `.yml` file.
* @param origin - path used in notes and error messages.
* @returns the validated document with its notes.
* @throws {PolicyConfigError} when the document cannot be used at all.
*/
function parsePolicyDocument(text, format, origin) {
	let parsed;
	if (format === "json") try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new PolicyConfigError(`${origin}: invalid JSON (${error.message})`);
	}
	else parsed = parseYamlSubset(text);
	return documentFromValue(parsed, origin);
}
/**
* Merge the project override layer over the built-in rules.
*
* `rules` entries are applied first: an entry whose id already exists replaces
* that rule where it stands (so a project can loosen a shipped `deny` to `ask`),
* and an entry with a new id is appended. `disable` ids are applied second and
* always win, so a project can disable anything, including a rule it just
* appended.
*
* @param builtin - the effective rules before the project layer.
* @param document - the parsed project document.
* @returns the merged rule list and the notes produced by merging.
*/
function mergePolicyRules(builtin, document) {
	const rules = [...builtin];
	const notes = [];
	for (const override of document.rules) {
		const index = rules.findIndex((rule) => rule.id === override.id);
		if (override.action === "allow") {
			if (index < 0) notes.push(`rule "${override.id}": nothing to retire with action allow`);
			else rules.splice(index, 1);
			continue;
		}
		const merged = {
			id: override.id,
			tool: override.tool,
			pattern: override.pattern,
			action: override.action,
			reason: override.reason,
			remedy: override.remedy,
			source: override.source.length > 0 ? override.source : "project policy override"
		};
		if (index < 0) rules.push(merged);
		else rules[index] = merged;
	}
	for (const id of document.disable) {
		const index = rules.findIndex((rule) => rule.id === id);
		if (index < 0) notes.push(`disable "${id}": no rule with that id`);
		else rules.splice(index, 1);
	}
	return {
		rules,
		notes
	};
}
//#endregion
//#region packages/safe-tool-call-policy/src/host/policy-file.ts
/**
* Filesystem side of the policy: locate a project's `.dsh/policy.yml` (or
* `.dsh/policy.json`), read it next to the shipped `danger-patterns.json`, and
* return one effective rule set.
*
* This module is the only place that touches disk, and it never throws. Its
* two failure modes are both fail-open, because a policy that cannot read its
* own inputs must not become a new way for a call to fail:
*
* - The project file exists but cannot be read or parsed → **no rule applies**
*   and the note says why. Falling back to the built-in list would be worse: the
*   project may have been disabling or loosening exactly those rules.
* - The shipped pattern set cannot be read → no rule applies, with a note. That
*   file is part of the package, so this only happens on a broken install.
*
* A missing project file is not a failure: the built-in list is the default.
*/
/** Project policy files, in precedence order: the first one that exists is authoritative. */
const POLICY_FILES = [{
	file: "policy.yml",
	format: "yaml"
}, {
	file: "policy.json",
	format: "json"
}];
/** Actions the shipped pattern set may use; `allow` belongs to project overrides only. */
const BUILTIN_ACTIONS = /* @__PURE__ */ new Set(["ask", "deny"]);
/**
* Resolve the project policy file under `projectRoot`, if any.
*
* @param projectRoot - directory that would contain `.dsh/`.
* @returns the first existing candidate, or `undefined`.
*/
function findPolicyFile(projectRoot) {
	try {
		for (const candidate of POLICY_FILES) {
			const path = join(projectRoot, ".dsh", candidate.file);
			if (existsSync(path)) return {
				path,
				format: candidate.format
			};
		}
	} catch {
		return;
	}
}
/**
* Read and validate the shipped pattern set.
*
* @param builtinUrl - URL of `danger-patterns.json`.
* @returns the rules, or an empty list plus one note when the file is unusable.
*/
function readBuiltinRules(builtinUrl) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(builtinUrl, "utf8"));
	} catch (error) {
		return {
			rules: [],
			notes: [`shipped danger-pattern set is unreadable (${error.message}); no rule applies`]
		};
	}
	if (!Array.isArray(parsed)) return {
		rules: [],
		notes: ["shipped danger-pattern set is not a list; no rule applies"]
	};
	const rules = [];
	const notes = [];
	for (const [index, entry] of parsed.entries()) {
		const result = validateRuleEntry(entry, index, BUILTIN_ACTIONS);
		if (!("rule" in result)) {
			notes.push(`shipped danger-pattern set: ${result.error}`);
			continue;
		}
		const rule = result.rule;
		if (rule.action === "allow") {
			notes.push(`shipped danger-pattern set: rules[${index}] uses action allow, which only a project override may use`);
			continue;
		}
		rules.push({
			id: rule.id,
			tool: rule.tool,
			pattern: rule.pattern,
			action: rule.action,
			reason: rule.reason,
			remedy: rule.remedy,
			source: rule.source
		});
	}
	return {
		rules,
		notes
	};
}
/**
* Load the effective policy for one project root.
*
* @param options - project root and the shipped pattern-set location.
* @returns the effective rules plus every fail-open note. Never throws.
*/
function loadPolicy(options) {
	const builtin = readBuiltinRules(options.builtinUrl);
	const file = findPolicyFile(options.projectRoot);
	if (file === void 0) return {
		rules: builtin.rules,
		notes: builtin.notes
	};
	let text;
	try {
		text = readFileSync(file.path, "utf8");
	} catch (error) {
		return {
			rules: [],
			notes: [...builtin.notes, `project policy ${file.path} is unreadable (${error.message}); fail-open, no rule applies`],
			sourcePath: file.path
		};
	}
	try {
		const document = parsePolicyDocument(text, file.format, file.path);
		const merged = mergePolicyRules(builtin.rules, document);
		return {
			rules: merged.rules,
			notes: [
				...builtin.notes,
				...document.notes,
				...merged.notes
			],
			sourcePath: file.path
		};
	} catch (error) {
		return {
			rules: [],
			notes: [...builtin.notes, `project policy ${file.path} is unusable (${error.message}); fail-open, no rule applies`],
			sourcePath: file.path
		};
	}
}
//#endregion
//#region packages/safe-tool-call-policy/src/shared/evaluate.ts
/** Relative severity of the two blocking verdicts; `allow` never competes. */
const SEVERITY = {
	ask: 1,
	deny: 2
};
/**
* Compiled patterns, keyed by source text. `evaluateCall` stays a pure function
* of its arguments — this is a memo of a deterministic transformation, not
* state the caller can observe.
*/
const compiledPatterns = /* @__PURE__ */ new Map();
/** Compile a rule pattern, remembering (and reporting) a pattern that cannot compile. */
function compilePattern(pattern) {
	const cached = compiledPatterns.get(pattern);
	if (cached !== void 0) return cached;
	let compiled;
	try {
		compiled = new RegExp(pattern);
	} catch {
		compiled = null;
	}
	compiledPatterns.set(pattern, compiled);
	return compiled;
}
/**
* Match one call against the effective rule set.
*
* @param call - the pending call reduced to `{ tool, text }`.
* @param rules - effective rules in evaluation order (built-in list with the
*   project override layer already merged).
* @returns the strictest verdict — `allow` when nothing matched — with the
*   deciding rule's reason and remedy, every matching id, and any note.
*/
function evaluateCall(call, rules) {
	const matched = [];
	const notes = [];
	let winner;
	for (const rule of rules) {
		if (rule.tool !== "*" && rule.tool !== call.tool) continue;
		const pattern = compilePattern(rule.pattern);
		if (pattern === null) {
			notes.push(`rule "${rule.id}": pattern is not a valid regular expression and was skipped`);
			continue;
		}
		if (!pattern.test(call.text)) continue;
		matched.push(rule.id);
		if (winner === void 0 || SEVERITY[rule.action] > SEVERITY[winner.action]) winner = rule;
	}
	if (winner === void 0) return {
		action: "allow",
		matched,
		notes
	};
	return {
		action: winner.action,
		ruleId: winner.id,
		reason: winner.reason,
		remedy: winner.remedy,
		matched,
		notes
	};
}
//#endregion
//#region packages/safe-tool-call-policy/src/shared/reason.ts
/** Fallback reason for a decision that somehow carries none; keeps the render total. */
const FALLBACK_REASON = "Blocked by the safe-tool-call policy.";
/**
* Render one blocking decision as a single line: what was stopped, how to do it
* compliantly, and which rule decided. English on purpose — the text joins a
* tool result and is tokenized like any other model-visible output.
*
* @param decision - an `ask` or `deny` decision from {@link evaluateCall}.
* @returns the reason line, never empty and never throwing.
*/
function renderPolicyReason(decision) {
	const parts = [decision.reason ?? FALLBACK_REASON];
	if (decision.remedy !== void 0 && decision.remedy.length > 0) parts.push(decision.remedy);
	if (decision.ruleId !== void 0) parts.push(`(safe-tool-call-policy rule: ${decision.ruleId})`);
	return parts.join(" ");
}
//#endregion
//#region packages/safe-tool-call-policy/src/index.ts
/** Cordis plugin name used by loader diagnostics; equals the entry id derived from the package name. */
const name = "safe-tool-call-policy";
/** The tool registry owns both extension points this package uses. */
const inject = ["tools"];
/**
* The shipped pattern set. Resolved relative to this module, which sits one
* level below the package root in both layouts — `src/index.ts` in the source
* tree and `lib/index.js` in the built bundle — so the same specifier is
* correct for tests and for an installed package.
*/
const BUILTIN_PATTERN_SET = new URL("../danger-patterns.json", import.meta.url);
/** The project root a call belongs to: the session workspace, or this process when there is none. */
function projectRootOf(exec) {
	const cwd = exec.agent?.session.header.cwd;
	return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}
/**
* Build the evaluator for one loaded plugin instance.
*
* @param ctx - the plugin context, used only to log fail-open notes.
* @returns a total function: any internal failure resolves to `allow`.
*/
function createDecide(ctx) {
	return (exec) => {
		try {
			const policy = loadPolicy({
				projectRoot: projectRootOf(exec),
				builtinUrl: BUILTIN_PATTERN_SET
			});
			for (const note of policy.notes) ctx.logger.warn(`safe-tool-call-policy: ${note}`);
			return evaluateCall(callShapeOf(exec.name, exec.arguments), policy.rules);
		} catch (error) {
			ctx.logger.warn(`safe-tool-call-policy: evaluation failed (${error.message}); allowing the call`);
			return {
				action: "allow",
				matched: [],
				notes: []
			};
		}
	};
}
/**
* Register the two policy hooks on the plugin fiber.
*
* @param ctx - the plugin context; both hooks unregister when it unloads.
*/
function apply(ctx) {
	const decide = createDecide(ctx);
	ctx.on("tools/pre-execute", async (exec, next) => {
		const decision = decide(exec);
		return decision.action === "ask" ? {
			kind: "ask",
			reason: renderPolicyReason(decision)
		} : next();
	});
	ctx.effect(() => ctx.tools.guard((exec) => {
		const decision = decide(exec);
		return decision.action === "deny" ? renderPolicyReason(decision) : void 0;
	}), "safe-tool-call-policy: deny guard");
}
//#endregion
export { apply, inject, name };
