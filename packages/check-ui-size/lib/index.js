import { defineTool } from "@deepseek-ai/dsh-tools";
import { accessSync, constants } from "node:fs";
import { chromium } from "playwright-core";
import { Service } from "@deepseek-ai/cordis";
//#region packages/check-ui-size/src/host/measure.ts
/**
* Measurement core: open a page in a real browser, read one element's rendered
* box and the box styles that explain it, and optionally diff that against an
* expected size.
*
* Why a browser instead of parsing CSS: a declaration is not a result. A board
* can say `min-height: 27px` and the button still renders 34px tall, because
* line-height, padding, or an oversized child wins. Only the laid-out box tells
* the truth, so this core reads `getBoundingClientRect()` and `getComputedStyle()`
* from the live document and reports numbers a receipt can cite.
*
* The host half never guesses: a missing browser, a failed navigation, or a selector
* that matches nothing returns a typed failure rather than a partial result.
*/
/** Candidate browsers, in preference order, when nothing is configured. */
const DEFAULT_BROWSER_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium"
];
/** Default navigation and selector budget. */
const DEFAULT_TIMEOUT_MS = 15e3;
/** Round to 3 decimals so float noise never reaches a receipt. */
function round(value) {
	return Math.round(value * 1e3) / 1e3;
}
/**
* Resolve the browser executable.
*
* Order: the explicit option, then `SOIA_CHROME_EXECUTABLE`, then the usual
* install locations. Returns undefined when nothing is executable, which the
* caller reports as `browser_missing` instead of launching a downloaded browser.
* @param explicit - Caller-provided path, highest priority.
* @returns An executable path, or undefined when none is found.
*/
function resolveBrowserExecutable(explicit) {
	const candidates = [
		explicit,
		process.env["SOIA_CHROME_EXECUTABLE"],
		...DEFAULT_BROWSER_CANDIDATES
	];
	for (const candidate of candidates) {
		if (candidate === void 0 || candidate === "") continue;
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
}
/**
* Signed difference between the rendered box and the expected size.
* @param rect - Measured box.
* @param expected - Expected size; each side is optional.
* @returns Differences for the sides that were provided, or undefined when none were.
*/
function diffAgainstExpected(rect, expected) {
	if (expected === void 0) return void 0;
	const diff = {};
	if (typeof expected.width === "number") diff.width = round(rect.width - expected.width);
	if (typeof expected.height === "number") diff.height = round(rect.height - expected.height);
	return Object.keys(diff).length > 0 ? diff : void 0;
}
/** Build a typed failure without partial measurements. */
function failure(code, message, options) {
	return {
		status: "error",
		plugin: "soia-dsh-tool-check-ui-size",
		code,
		message,
		url: options.url,
		selector: options.selector
	};
}
/**
* Read one element from one page.
* @param options - Target URL, selector, optional expected size and overrides.
* @returns A measured element, or a typed failure explaining why it is absent.
*/
async function measureElement(options) {
	const { url, selector, expected } = options;
	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const executablePath = resolveBrowserExecutable(options.executablePath);
	if (executablePath === void 0) return failure("browser_missing", "no browser executable found; set SOIA_CHROME_EXECUTABLE to a Chrome/Chromium binary", options);
	const inCi = (process.env["CI"] ?? "") !== "";
	const browser = await chromium.launch({
		executablePath,
		headless: true,
		...inCi ? {
			chromiumSandbox: false,
			args: ["--disable-dev-shm-usage"]
		} : {}
	});
	try {
		const page = await browser.newPage();
		try {
			await page.goto(url, {
				waitUntil: "load",
				timeout
			});
		} catch (error) {
			return failure("navigation_failed", `could not load ${url}: ${String(error)}`, options);
		}
		try {
			await page.waitForSelector(selector, {
				timeout,
				state: "attached"
			});
		} catch {
			return failure("element_not_found", `selector matched no element: ${selector}`, options);
		}
		let measured;
		try {
			measured = await page.evaluate((sel) => {
				const matches = document.querySelectorAll(sel);
				const element = matches[0];
				if (element === void 0) throw new Error("no element for selector");
				const rect = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				const length = (value) => {
					const parsed = Number.parseFloat(value);
					return Number.isFinite(parsed) ? parsed : null;
				};
				const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
				return {
					selector: sel,
					matched: matches.length,
					visible,
					rect: {
						x: Math.round(rect.x * 1e3) / 1e3,
						y: Math.round(rect.y * 1e3) / 1e3,
						width: Math.round(rect.width * 1e3) / 1e3,
						height: Math.round(rect.height * 1e3) / 1e3
					},
					computed: {
						width: length(style.width) ?? 0,
						height: length(style.height) ?? 0,
						minWidth: length(style.minWidth),
						minHeight: length(style.minHeight),
						maxWidth: length(style.maxWidth),
						maxHeight: length(style.maxHeight),
						paddingTop: length(style.paddingTop) ?? 0,
						paddingBottom: length(style.paddingBottom) ?? 0,
						fontSize: length(style.fontSize) ?? 0,
						lineHeight: length(style.lineHeight),
						boxSizing: style.boxSizing,
						display: style.display
					}
				};
			}, selector);
		} catch (error) {
			return failure("evaluate_failed", `could not read geometry: ${String(error)}`, options);
		}
		const viewport = page.viewportSize() ?? {
			width: 0,
			height: 0
		};
		const diff = diffAgainstExpected(measured.rect, expected);
		return {
			...measured,
			status: "ok",
			url,
			measuredAt: (/* @__PURE__ */ new Date()).toISOString(),
			viewport,
			...expected === void 0 ? {} : { expected },
			...diff === void 0 ? {} : { diff }
		};
	} finally {
		await browser.close();
	}
}
//#endregion
//#region packages/check-ui-size/src/host/health.ts
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
var UiSizeHealth = class extends Service {
	calls = 0;
	failures = 0;
	lastCallAt = null;
	lastFailureAt = null;
	measured = 0;
	/**
	* @param ctx - host context owning this service's lifetime.
	*/
	constructor(ctx) {
		super(ctx, "checkUiSizeHealth");
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
	/** Record one successful measurement. */
	recordMeasured() {
		this.measured += 1;
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
			measured: this.measured
		});
	}
};
//#endregion
//#region packages/check-ui-size/src/index.ts
const name = "tool-check-ui-size";
/**
* Both services are host-provided and must be ready before `apply` runs:
* `tools` owns the registry this package registers into, and `systemPrompt`
* owns the section registry it contributes to.
*/
const inject = ["tools", "systemPrompt"];
/**
* Stable name of the prompt section this package owns: `tool:` plus the tool
* name, which is the shape the official tool packages use (`dsh-tool-bash`
* registers `tool:bash`). The kind prefix belongs to the package name, not to
* the tool.
*/
const CHECK_UI_SIZE_SECTION = "tool:check_ui_size";
/**
* Placement in the assembled system prompt. Built-in tool guidance occupies
* 1000–3100 and SDK tools start at 5000, so 3200 keeps this section next to the
* other tool guidance. Equal orders are broken by section name, and a deployment
* or agent preset can shadow this section by registering the same name.
*/
const CHECK_UI_SIZE_SECTION_ORDER = 3200;
/**
* The model-facing rule this package adds, in English on purpose: this text is
* paid for on every single request, and English costs roughly a third of what
* the same content costs in Han characters under realistic tokenization. The
* detailed acceptance procedure still belongs to the skill that is loaded on
* demand, not to a section that is always resident.
*/
const GUIDANCE = ["UI acceptance needs a check_ui_size measurement, not CSS alone.", "Measurement wins on disagreement; name the layer (layout, font, box model)."].join("\n");
/**
* Model-facing tool description. States what it does and when to reach for it,
* and deliberately stops there — usage instructions would be paid for on every
* request, while the model can read the parameter schema for the rest. Failure
* modes are not described either: a failed call returns `status: "error"` with
* a `code`, which the model reads from the result itself.
*/
const TOOL_DESCRIPTION = "Read one UI element's rendered size and box styles from a page URL, to check declared CSS against real geometry. Pass expectedHeight or expectedWidth for signed differences. Prefer it over hand-written browser scripts: fixed viewport, waits for idle, and reports rect vs computed with the expected diff.";
function apply(ctx) {
	const health = new UiSizeHealth(ctx);
	ctx.tools.register(defineTool({
		name: "check_ui_size",
		description: TOOL_DESCRIPTION,
		parameters: {
			url: {
				type: "string",
				required: true,
				description: "Page URL, e.g. http://127.0.0.1:5173/"
			},
			selector: {
				type: "string",
				required: true,
				description: "CSS selector"
			},
			expectedHeight: {
				type: "number",
				description: "Expected height, CSS px"
			},
			expectedWidth: {
				type: "number",
				description: "Expected width, CSS px"
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
					url: { type: "string" },
					selector: { type: "string" },
					measuredAt: { type: "string" },
					matched: { type: "integer" },
					visible: { type: "boolean" },
					rect: {
						type: "object",
						additionalProperties: false,
						properties: {
							x: { type: "number" },
							y: { type: "number" },
							width: { type: "number" },
							height: { type: "number" }
						}
					},
					computed: {
						type: "object",
						additionalProperties: false,
						properties: {
							width: { type: "number" },
							height: { type: "number" },
							minWidth: { oneOf: [{ type: "number" }, { type: "null" }] },
							minHeight: { oneOf: [{ type: "number" }, { type: "null" }] },
							maxWidth: { oneOf: [{ type: "number" }, { type: "null" }] },
							maxHeight: { oneOf: [{ type: "number" }, { type: "null" }] },
							paddingTop: { type: "number" },
							paddingBottom: { type: "number" },
							fontSize: { type: "number" },
							lineHeight: { oneOf: [{ type: "number" }, { type: "null" }] },
							boxSizing: { type: "string" },
							display: { type: "string" }
						}
					},
					viewport: {
						type: "object",
						additionalProperties: false,
						properties: {
							width: { type: "integer" },
							height: { type: "integer" }
						}
					},
					expected: {
						type: "object",
						additionalProperties: false,
						properties: {
							width: { type: "number" },
							height: { type: "number" }
						}
					},
					diff: {
						type: "object",
						additionalProperties: false,
						properties: {
							width: { type: "number" },
							height: { type: "number" }
						}
					},
					code: { type: "string" },
					message: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		async execute(args) {
			const expected = args.expectedWidth === void 0 && args.expectedHeight === void 0 ? void 0 : {
				...args.expectedWidth === void 0 ? {} : { width: args.expectedWidth },
				...args.expectedHeight === void 0 ? {} : { height: args.expectedHeight }
			};
			const result = await measureElement({
				url: args.url,
				selector: args.selector,
				...expected === void 0 ? {} : { expected }
			});
			health.record(result.status !== "ok");
			if (result.status === "ok") health.recordMeasured();
			return result;
		}
	}));
	ctx.systemPrompt.section({
		name: CHECK_UI_SIZE_SECTION,
		order: CHECK_UI_SIZE_SECTION_ORDER,
		text: GUIDANCE
	});
}
//#endregion
export { CHECK_UI_SIZE_SECTION, CHECK_UI_SIZE_SECTION_ORDER, apply, inject, name };
