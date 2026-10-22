import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: "node",
		include: [
			"src/**/*.test.ts",
			"packages/*/**/*.test.ts",
			// Pure helpers of the Playwright suite (no browser).
			"e2e/**/*.test.ts",
		],
		// Real-Postgres tests run through `pnpm test:pg` (vitest.pg.config.ts).
		exclude: [...configDefaults.exclude, "**/*.pg.test.ts"],
		// The module cache keys a file by its own content, so it would keep a
		// stale import.meta.glob result and miss new message files
		// (packages/i18n/src/load.ts). Turning it off costs no measurable time.
		fsModuleCache: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: [
				"src/lib/**/*.ts",
				"src/server/**/*.ts",
				"packages/domain/src/**/*.ts",
			],
			exclude: [
				"src/**/__tests__/**",
				"**/*.test.ts",
				"packages/domain/src/currencies.ts",
				"src/lib/supported-crypto-icons.ts",
				"src/lib/db-enums.ts",
			],
			thresholds: {
				lines: 20,
				functions: 20,
				branches: 20,
				statements: 20,
			},
		},
	},
});
