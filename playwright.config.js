const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");
const baseURL = process.env.BASE_URL || "http://127.0.0.1:5055";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  workers: 1,
  use: {
    baseURL,
    headless: true,
    launchOptions: { executablePath, args: ["--no-sandbox"] },
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command: `${process.env.PYTHON || "python3"} app.py`,
    url: `${baseURL}/api/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
    env: { PORT: new URL(baseURL).port || "5055" },
  },
  reporter: process.env.CI ? "github" : "list",
});
