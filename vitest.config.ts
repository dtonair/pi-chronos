import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const aliases = {
  "#domain": resolve(__dirname, "src/domain"),
  "#api": resolve(__dirname, "src/api"),
  "#shared": resolve(__dirname, "src/shared"),
  "#config": resolve(__dirname, "src/config"),
};

export default defineConfig({
  resolve: { alias: aliases },
  coverage: {
    provider: "v8",
    include: ["src/**/*.ts"],
    exclude: ["src/**/*.d.ts"],
    reporter: ["text", "json-summary"],
  },
  test: {
    maxWorkers: 1,
    minWorkers: 1,
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
          pool: "threads",
          poolOptions: {
            threads: {
              singleThread: true,
            },
          },
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          pool: "threads",
          poolOptions: {
            threads: {
              singleThread: true,
            },
          },
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: "acceptance",
          include: ["test/acceptance/**/*.test.ts", "test/fault/**/*.test.ts", "test/e2e/**/*.test.ts"],
          environment: "node",
          pool: "threads",
          poolOptions: { threads: { singleThread: true } },
        },
      },
    ],
  },
});
