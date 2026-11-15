import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Hutch projects a third-party SDK (including its own Bun tests) here.
    // Exercise our adapter with Vitest and the native runtime with test:electrobun.
    exclude: [
      ...configDefaults.exclude,
      "**/.hutch/**",
      "electrobun/build/**",
      "electrobun/artifacts/**",
    ],
  },
});
