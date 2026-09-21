import { defineConfig } from 'tsdown'

/**
 * One bundle per plugin package: `packages/<pkg>/src/index.ts` ->
 * `packages/<pkg>/lib/index.js`.
 *
 * Declarations are intentionally NOT produced here. Each package's
 * `build:types` script runs `tsc -p tsconfig.json` with
 * `rootDir: src` / `outDir: lib/types`, which writes exactly the
 * `lib/types/index.d.ts` path that the package manifest declares. Keeping the
 * two outputs on separate tools is what makes `main` and `types` agree with
 * the `files` allowlist.
 *
 * Add a new entry here when a package is added to `pnpm-workspace.yaml`; the
 * official checklist does not discover entries automatically.
 */
export default defineConfig([
  {
    entry: ['packages/check-ui-size/src/index.ts'],
    outDir: 'packages/check-ui-size/lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    sourcemap: false,
    clean: true,
    // The manifest declares `main: lib/index.js`; tsdown's ESM default is
    // `.mjs`, which would publish an entry point that does not exist.
    outExtensions: () => ({ js: '.js' }),
    // Host-provided packages are peer dependencies: never inline them.
    // Host-provided packages are peers and the browser driver is a runtime
    // dependency of the package: neither may be inlined into the bundle.
    deps: { neverBundle: [/^@deepseek-ai\//, 'playwright-core'] },
  },
])
