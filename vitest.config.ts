import { defineConfig } from 'vitest/config'

/**
 * Tests live beside the package they cover, under `packages/<pkg>/tests/`.
 * Test files import `describe`/`it`/`expect` from `vitest` explicitly, so no
 * global test API is injected.
 */
export default defineConfig({
  test: {
    // Package tests live beside their package; `tests/` holds repository-level
    // tests (the scripts under scripts/, the client artifact shape).
    include: ['packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    // The browser-backed cases launch a real Chrome: a few hundred ms locally,
    // but several seconds on a cold container. The default 5s budget is a
    // launcher-speed assertion, not a correctness one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
