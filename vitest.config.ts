import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'src/tests'],
    },
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      // Allow .js imports to resolve .ts files (ESM compat)
    },
  },
});
