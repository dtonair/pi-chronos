import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [],
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    pool: "vmThreads",
  },
  resolve: {
    alias: {
      "#domain": resolve(__dirname, "src/domain"),
      "#api": resolve(__dirname, "src/api"),
      "#shared": resolve(__dirname, "src/shared"),
      "#config": resolve(__dirname, "src/config"),
    },
  },
});
