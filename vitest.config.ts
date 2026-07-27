import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Production runs under UTC (Vercel). Date parsing in the scraping engines
    // is timezone-sensitive — `new Date('January 15, 2024')` resolves to local
    // midnight — so without this pin the same test passes in CI and fails on a
    // developer machine in any non-UTC zone. Pinning here makes the suite
    // deterministic and makes it assert production's actual behaviour.
    env: { TZ: 'UTC' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
