import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so tests run from the repo root in Node.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
