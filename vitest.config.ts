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
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
          pool: "vmThreads",
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          pool: "forks",
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
    ],
  },
});
