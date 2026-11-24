import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WEB ?? "http://127.0.0.1:4310",
    ...(process.env.CHROMIUM ? { launchOptions: { executablePath: process.env.CHROMIUM } } : {}),
  },
});
