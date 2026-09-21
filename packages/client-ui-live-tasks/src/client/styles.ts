/**
 * Styles for the session-header action.
 *
 * Hand-written instead of a CSS-module import on purpose: a browser half is
 * bundled into the loader's lazy CommonJS factory, and pulling in a CSS build
 * pipeline (lightningcss + a virtual-module plugin) would add a second toolchain
 * to this repository for one 96-line stylesheet. Class names carry an `lt-`
 * prefix so they cannot collide with the page's own generic names, and the
 * stylesheet is injected once per document, tagged with the plugin id so it is
 * findable and removable.
 *
 * The theme variables (`--dsw-*`) come from the host shell; this file only
 * consumes them, so the panel follows the active theme without duplicating any
 * palette.
 */
const CSS = `.lt-root {
  position: relative;
}

.lt-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 3px 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  background: 0 0;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.lt-trigger:hover,
.lt-trigger:focus-visible {
  color: var(--dsw-alias-label-secondary);
}

.lt-dotIdle,
.lt-dotTool {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.lt-dotIdle {
  background: var(--dsw-alias-label-tertiary);
}

.lt-dotTool {
  background: var(--dsw-alias-label-secondary);
}

.lt-label {
  max-width: 18ch;
  overflow: hidden;
  font-family: var(--dsw-font-mono, monospace);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.lt-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  z-index: 100;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 336px;
  max-width: min(400px, 100vw - 32px);
  max-height: min(420px, 100vh - 140px);
  margin: 0;
  padding: 4px;
  overflow: auto;
  list-style: none;
  background: var(--dsw-specific-menu);
  border: 0;
  border-radius: 20px;
  box-shadow: var(--dsw-elevation-prominent);
}

.lt-row {
  box-sizing: border-box;
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  border-radius: 8px;
}

.lt-rowLabel {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.lt-rowValue {
  min-width: 0;
  overflow: hidden;
  font-family: var(--dsw-font-mono, monospace);
  white-space: nowrap;
  text-overflow: ellipsis;
}
`

/** Class names the component applies, prefixed so they stay this plugin's own. */
export const styles = {
  root: 'lt-root',
  trigger: 'lt-trigger',
  dotIdle: 'lt-dotIdle',
  dotTool: 'lt-dotTool',
  label: 'lt-label',
  menu: 'lt-menu',
  row: 'lt-row',
  rowLabel: 'lt-rowLabel',
  rowValue: 'lt-rowValue',
} as const

/** Plugin id the injected style tag is tagged with. */
const STYLE_TAG_ID = 'ui-live-tasks'

if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_TAG_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.append(tag)
}
