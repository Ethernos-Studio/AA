import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Keep parallelism low: launching many Chrome instances starves this machine and
  // produces launch timeouts that look like product failures.
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4319',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
    },
  ],
  // Dedicated port and never reuse: a foreign server on the same port would silently
  // serve another site and make every assertion meaningless.
  webServer: {
    command: 'node scripts/dev.mjs --port 4319',
    url: 'http://127.0.0.1:4319/wiki-config.json',
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
