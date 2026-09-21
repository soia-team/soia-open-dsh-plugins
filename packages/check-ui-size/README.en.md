---
description: "DSH host tool package that reads one UI element's measured size and box styles from a live page, optionally diffing them against an expected size."
kind: "package-bundle"
---

# soia-dsh-tool-check-ui-size

A DSH host tool package that measures one UI element's **actual rendered size** in a real browser, to counter "correct CSS declaration, incorrect real geometry".

[中文](README.md)

## What this package does

A declaration is not a result. A board can say `min-height: 27px` and the button still renders 34px tall, because line-height, padding, or an oversized child wins. Reading the declaration passes; only the laid-out box tells the truth.

This package therefore opens a real browser, reads `getBoundingClientRect()` and `getComputedStyle()`, and returns reproducible, receipt-citable numbers — plus a **signed difference** against an expected size when one is given.

It never guesses: a missing browser, an unreachable page, or a selector that matches nothing returns a typed failure instead of an invented measurement.

## Install

Not yet on npm; install from the git source (`lib/` is committed, so the installed package works without a local build):

```bash
dsh plugin --profile <profile-name> add 'github:soia-team/soia-open-dsh-plugins#path:packages/check-ui-size'
dsh --profile <profile-name> --dump-config   # configuration layer only; no service is started
```

Once published to npm, the same slot takes the package name: `dsh plugin --profile <profile-name> add soia-dsh-tool-check-ui-size`.

`cordis.patch.yml` contributes exactly one `insert` row: `id: tool-check-ui-size`, `name: soia-dsh-tool-check-ui-size`.

Browser resolution order: the call argument → `SOIADECK_CHROME_EXECUTABLE` → the usual install locations (Chrome / Chromium / Edge on macOS, `google-chrome` / `chromium` on Linux). The package depends on `playwright-core` and **downloads no browser**; when no executable is found it returns `browser_missing` rather than silently using a different one.

## Tool contract

### `check_ui_size`

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `url` | string | yes | Page to open, e.g. `http://127.0.0.1:5173/` |
| `selector` | string | yes | CSS selector of the target element |
| `expectedHeight` | number | no | Expected height in CSS pixels, from a board or spec |
| `expectedWidth` | number | no | Expected width in CSS pixels |

Success (`status: "ok"`) returns:

```json
{
  "status": "ok",
  "url": "http://127.0.0.1:5173/",
  "selector": "#submit",
  "measuredAt": "2026-09-21T07:14:03.812Z",
  "matched": 1,
  "visible": true,
  "rect": { "x": 24, "y": 118, "width": 96, "height": 34 },
  "computed": {
    "width": 96, "height": 34,
    "minWidth": 0, "minHeight": 27, "maxWidth": null, "maxHeight": null,
    "paddingTop": 0, "paddingBottom": 0,
    "fontSize": 14, "lineHeight": 34,
    "boxSizing": "border-box", "display": "inline-flex"
  },
  "viewport": { "width": 1280, "height": 720 },
  "expected": { "height": 27 },
  "diff": { "height": 7 }
}
```

- `rect` comes from `getBoundingClientRect()` and is the **laid-out box**; the `minHeight`-style fields under `computed` are the declaration side. Having both side by side is the point: the example declares 27 and measures 34.
- `diff` appears only when `expected*` was given and equals `measured - expected`, rounded to 3 decimals.
- `matched` reports how many elements the selector hit; the geometry always describes the **first** match.
- `visible` is `false` for `display:none`, `visibility:hidden`, or a zero-sized box.

Failure (`status: "error"`) returns `code` and `message`:

| `code` | Meaning |
|---|---|
| `browser_missing` | No executable Chrome/Chromium found; set `SOIADECK_CHROME_EXECUTABLE` to fix |
| `navigation_failed` | The page could not be loaded (unreachable, timed out) |
| `element_not_found` | The selector matched no element |
| `evaluate_failed` | The page opened but reading geometry failed |

Navigation and selector waits both default to 15 seconds.

## System prompt

The package registers one prompt section named `tool:check_ui_size` with `order` 3200 (built-in tool guidance occupies 1000–3100 and SDK tools start at 5000). It carries two English rules: a UI change's acceptance must cite measured size, and when declaration and measurement disagree the measurement wins, with the responsible layer named. **The resident text is English on purpose** — it is paid for on every request, and the same content costs roughly a third as much in real tokens as Han characters; the Chinese prose for humans stays in this README and in the skills. The verbatim text is under Model Experience below.

## Design notes

- **Shape**: host tool plus system-prompt section; no browser half, no client bundle, no `dsh.client` declaration.
- **Layering**: the measurement lives in `src/host/measure.ts` and the shared types in `src/shared/types.ts`; neither imports anything from DSH, so another host wrapper (an MCP server, for instance) can reuse them. `src/index.ts` only registers and wires. A future browser half goes in `src/client/`. Repository layout: [docs/structure.md](../../docs/structure.md).
- **Side-effect registration**: both the tool and the section register on the plugin fiber and unregister when it is disposed. The module holds no host state.
- **Dependencies**: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-system-prompt` are peers provided by the host; `playwright-core` is this package's runtime dependency and stays external in the build.
- **Naming**: npm name `soia-dsh-tool-check-ui-size` (the official `dsh-tool-*` shape with the `soia-` prefix), entry id `tool-check-ui-size`.
- **Extension points**: registers no `tools/pre-execute` or `tools/post-execute` policy hook, listens to no events, and exposes no configuration schema.

## Configuration and events

None. The package reads no configuration and emits no events.

## License

MIT. See the repository root [`LICENSE`](../../LICENSE).

## Model Experience

### The `check_ui_size` tool schema

#### What the model sees

The registered tool name `check_ui_size`, two required string parameters `url`/`selector`, two optional numeric parameters `expectedHeight`/`expectedWidth`, and the verbatim description below:

##### Verbatim tool description

```markdown
Read one UI element's actual rendered size and box styles from a live page URL, to check whether declared CSS values match real geometry. Pass expectedHeight or expectedWidth to get signed differences. Returns status "error" with a code when the browser, the page, or the selector is unavailable.
```

The model-facing tool catalog is generated by the host from the registered schema; this repository produces no such catalog, so there is no catalog anchor to cite here.

#### Token effect

Fixed. While the tool is visible, its name, description and four-parameter schema enter every assembly. **Measured: about 855 characters, roughly 214 tokens at the host token-meter's fixed density (≈4 characters per token).** The package appends no retained or dynamic context. A scope that hides the tool removes this contribution entirely.

#### KV Cache effect

Prefix-stable. Every field is a constant string, the package rewrites no tool block of its own, and no existing prefix loses reuse. The prefix changes only when this package's manifest changes those strings, or when another provider changes the tool's visibility or ordering — neither of which this package owns.

### The `tool:check_ui_size` prompt section

#### What the model sees

One static prompt section named `tool:check_ui_size` with `order` 3200, in full:

##### Verbatim section text

```markdown
UI acceptance needs a check_ui_size measurement, not declared CSS alone.
On disagreement the measurement wins; name the layer (layout, font, box model, scroll).
```

#### Token effect

Fixed. **Measured: 160 ASCII characters — about 40 tokens at the host's fixed density, which matches realistic tokenization for ASCII text (the two agree for English).** The earlier Chinese version was 93 characters: the host estimate showed only 23 tokens, while realistic Chinese tokenization costs about 68. **The host estimate counts characters, so it understates Chinese and overstates English — choose the language by real billing, not by the number in the UI.** No interpolation, no cap, no per-turn retention. A deployment or preset registering the same section name shadows it; an empty section contributes nothing.

#### KV Cache effect

Append-only growth of the system-prompt prefix. The text is a module-level constant, so consecutive assemblies render identical content and this package never invalidates reuse itself. The prefix changes only when this package's source text changes in a new version, or when a deployment or preset shadows the section — the latter is owned by the caller, not by this package.

## Known Limitations and Deferred Work

- **One browser per call.** No browser or page is reused across calls, so a single measurement costs roughly 0.5–1 s; measuring many elements on one page pays that repeatedly.
- **Only the first match is measured.** `matched` reports the total hit count, but the geometry describes the first match only; per-element checking needs several calls or an `all` option that does not exist yet.
- **No overflow check and no hit test.** Whether a child escapes its container, or whether an element can actually be clicked, are not registered capabilities; the repository's existing `scripts/design_board_fit.cjs` and `scripts/design_controls_visible.cjs` stay independent — this package neither calls nor copies them.
- **No evidence file is written.** The return value is citable structured JSON, but nothing is persisted to an evidence directory; the caller saves the output when a record is needed.
- **No screenshot and no visual comparison.** This package reads numbers only; it does not compare pixels or hand images to a vision model — that belongs to the vision plugins.
- **Compatibility is unverified.** The `dsh.compatibility.dsh` range `>=0.1.0-rc.8 <0.2.0` follows ecosystem convention; under strict node-semver semantics that range does **not** match prereleases (such as `0.1.5-rc.2` or `0.1.6-alpha.2`), because a prerelease needs a comparator on the same tuple. The peer dependencies therefore enumerate the published prereleases one by one. This package **has not been verified loading on any DSH version yet**; the `dshReleases` map will be added once loading evidence exists.
- **Verification depth.** The repository tests cover the measurement core, including real-browser cases; the smoke check proves only that the bundle row reaches the composed configuration tree. Loading the plugin in a live profile, and a real model-initiated call, remain separate evidence that has not been obtained.
