import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: "list",
  webServer: {
    command: "npm run demo",
    cwd: "..",
    url: "http://localhost:5173/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
