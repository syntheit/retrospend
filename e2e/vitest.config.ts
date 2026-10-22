// Unit tests for the e2e helpers (no browser, no server):
//   pnpm vitest run --config e2e/vitest.config.ts
// The root vitest config only includes src/ and packages/.
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["**/*.test.ts"],
		environment: "node",
	},
});
