import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The browser half is only useful in the exact artifact shape the client module
 * loader accepts, and that shape is produced by `scripts/build-client.mjs`
 * rather than by a published preset. These assertions pin the shape — they are
 * the cheapest possible guard against a build that produces a valid bundle the
 * loader silently ignores.
 */
const repoRoot = join(import.meta.dirname, '..', '..')

function clientArtifact(): string {
  return readFileSync(join(repoRoot, 'packages/client-ui-live-tasks/lib/client.js'), 'utf8')
}

describe('client bundle artifact', () => {
  it('registers itself through the loader call the shell provides', () => {
    const artifact = clientArtifact()
    expect(artifact).toContain('window.__ModuleLoader__.load({')
    expect(artifact).toContain('id: "soia-dsh-client-ui-live-tasks"')
    expect(artifact).toContain('factory: (require) => {')
    expect(artifact).toContain('return module.exports;')
  })

  it('resolves host-provided modules through the injected require, never by bundling them', () => {
    const artifact = clientArtifact()
    // The two the browser half actually reaches for: the JSX runtime and the
    // design-system primitives. Both come from the loader's module table.
    expect(artifact).toContain('require("react/jsx-runtime")')
    expect(artifact).toContain('require("@deepseek-ai/dsh-client-ui-primitives")')

    // Every runtime dependency must be one the shell serves. A bundle that
    // pulled in its own copy would show up here as a bare package name.
    const required = [...artifact.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
    expect(required.length).toBeGreaterThan(0)
    for (const name of required) {
      expect(name).toMatch(/^(react(-dom)?(\/[a-z-]+)?|@deepseek-ai\/)/)
    }

    // No React implementation is inlined: the artifact stays around 10 kB, where
    // a bundled react would put it in the hundreds.
    // The real property is "no React implementation is inlined". The size proxy
    // kept breaking as legitimate features landed (table metrics, drawer), so it
    // is now checked by what a bundled React would contain, with the size bound
    // kept loose as a second net: a real inline lands well past 200KB.
    expect(artifact).not.toContain('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
    expect(artifact.length).toBeLessThan(200_000)
  })

  it('ships a CommonJS body with the plugin exports and no ESM leftovers', () => {
    const artifact = clientArtifact()
    expect(artifact).toContain('exports.apply = apply')
    expect(artifact).toContain('exports.inject = inject')
    expect(artifact).not.toMatch(/^import /m)
    expect(artifact).not.toMatch(/^export /m)
  })

  it('carries the layout stylesheet inline instead of depending on a CSS toolchain', () => {
    const artifact = clientArtifact()
    expect(artifact).toContain('data-plugin-css')
    expect(artifact).toContain('.lt-view')
  })
})
