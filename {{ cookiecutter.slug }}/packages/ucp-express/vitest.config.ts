import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ucp/express": resolve(__dirname, "src"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
    },
  },
});
