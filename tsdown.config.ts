import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'

/**
 * One bundle per plugin package: `packages/<pkg>/src/index.ts` ->
 * `packages/<pkg>/lib/index.js`.
 *
 * Entries are **discovered from the filesystem** rather than listed by hand: a
 * hardcoded list silently skipped any package someone forgot to add, and the
 * failure only surfaced later, as a published tarball with no `lib/index.js`.
 * The discovery rule is exactly "has a host entry point".
 *
 * Declarations are intentionally NOT produced here. Each package's
 * `build:types` script runs `tsc -p tsconfig.json` with
 * `rootDir: src` / `outDir: lib/types`, which writes exactly the
 * `lib/types/index.d.ts` path that the package manifest declares. Keeping the
 * two outputs on separate tools is what makes `main` and `types` agree with the
 * `files` allowlist.
 *
 * A package with a browser half (`src/client/index.tsx`) is bundled by the
 * separate browser config below, not by the host config.
 */
const packagesDir = 'packages'

function packageDirs() {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
}

const hostEntries = packageDirs().filter((name) => existsSync(join(packagesDir, name, 'src/index.ts')))
const clientEntries = packageDirs().filter((name) => existsSync(join(packagesDir, name, 'src/client/index.tsx')))

const shared = {
  format: 'esm' as const,
  sourcemap: false,
  clean: true,
  // The manifests declare `main: lib/index.js`; tsdown's ESM default is `.mjs`,
  // which would publish an entry point that does not exist.
  outExtensions: () => ({ js: '.js' }),
  // Host-provided packages are peers and must never be inlined. The browser
  // driver is a runtime dependency of the package that uses it, not something
  // to copy into every bundle.
  deps: { neverBundle: [/^@deepseek-ai\//, 'playwright-core'] },
}

export default defineConfig([
  ...hostEntries.map((name) => Object.assign({}, shared, {
    entry: [`${packagesDir}/${name}/src/index.ts`],
    outDir: `${packagesDir}/${name}/lib`,
    platform: 'node' as const,
    dts: false,
  })),
  ...clientEntries.map((name) => Object.assign({}, shared, {
    entry: [`${packagesDir}/${name}/src/client/index.tsx`],
    outDir: `${packagesDir}/${name}/lib`,
    platform: 'browser' as const,
    dts: false,
  })),
])
