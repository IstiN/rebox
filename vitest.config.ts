import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
