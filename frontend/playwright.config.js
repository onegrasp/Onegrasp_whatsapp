import { defineConfig, devices } from "@playwright/test";

// Browser tests: the production build of the app, driven like a user would,
// against a fake backend (e2e/fakeApi.js). Nothing touches a real database and
// no WhatsApp message is sent.
//
//   npm run test:e2e                 (bundled Chromium; `npx playwright install chromium` once)
//   PW_CHANNEL=msedge npm run test:e2e   (use the installed Microsoft Edge instead)
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  // Two browsers at a time: more makes slower machines (and CI runners) flaky.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL || undefined }, grep: /@phone/ },
  ],
  webServer: {
    // The app talks to http://api.test, which only exists inside the tests.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    env: { VITE_API_URL: "http://api.test" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
