import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    // Un solo hilo: los tests comparten una base y se pisarian entre si.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
  },
})
