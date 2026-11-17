import { defineConfig, devices } from '@playwright/test';

/**
 * Mock-mode E2E: runs the FULL pipeline (upload -> index -> retrieve ->
 * stream -> citations) with RAG_MOCK=1, so it needs no API key and makes no
 * paid calls. Complements the real-provider smoke tests.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: 'mock.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    env: {
      RAG_MOCK: '1',
    },
  },
});
