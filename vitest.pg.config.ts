import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `pnpm test:pg`: tests that need a real Postgres (TEST_DATABASE_URL).
// vitest.config.ts excludes these, so `pnpm test` runs without a database.
export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: {
			"server-only": fileURLToPath(
				new URL("./src/test/server-only-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.pg.test.ts"],
		globalSetup: ["src/test/pg-global-setup.ts"],
		setupFiles: ["src/test/pg-env.ts"],
		// Files share one database per run (AppSettings is a singleton row).
		fileParallelism: false,
		testTimeout: 30_000,
	},
});
