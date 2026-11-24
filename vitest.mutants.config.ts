import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["packages/core/src/compare.test.ts"], testTimeout: 30_000 } });
