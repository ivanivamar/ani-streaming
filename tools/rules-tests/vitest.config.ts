import { defineConfig } from 'vitest/config';

// One shared emulator: run files one after another, each test starts from an empty database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
