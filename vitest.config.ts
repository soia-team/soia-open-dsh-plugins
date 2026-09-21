import { defineConfig } from 'vitest/config'

/**
 * Tests live beside the package they cover, under `packages/<pkg>/tests/`.
 * Test files import `describe`/`it`/`expect` from `vitest` explicitly, so no
 * global test API is injected.
 */
export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
  },
})
