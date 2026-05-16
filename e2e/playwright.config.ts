import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['POLYLOCALE_E2E_PORT'] ?? 4173);
const isCI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // The SPA is served by a single-threaded `vite preview` instance. More
  // than ~4 parallel test workers tends to cause request-queue timeouts
  // on slower runners; 4 is the empirical sweet spot for runtime under
  // 3 minutes for the bootstrap suite. CI uses a single worker for the
  // most deterministic timing.
  workers: isCI ? 1 : 4,
  reporter: isCI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 5_000,
    // 10 s was too tight on a cold worker: the first `page.goto('/')` in the
    // earliest alphabetical spec file can race the Vite preview warm-up.
    // Bump to 30 s so a one-off cold hit does not need a retry to recover.
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `vite preview` serves the production build; the SPA is fully client-side.
    // `--strictPort` makes a port clash fail loudly instead of hopping.
    // Binding to 127.0.0.1 explicitly keeps URL parity with `baseURL` —
    // some CI runners only resolve one of `localhost` / `127.0.0.1`.
    command: `pnpm --filter @polylocale/app exec vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
