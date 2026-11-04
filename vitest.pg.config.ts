import { fileURLToPath } from "node:url";
import {
	defineConfig,
	type TestProjectInlineConfiguration,
} from "vitest/config";

// `pnpm test:pg`: tests that need a real Postgres (TEST_DATABASE_URL).
// vitest.config.ts excludes these, so `pnpm test` runs without a database.
//
// Two projects share one setup. Regular files run in parallel, one cloned
// database per worker (pg-global-setup.ts, picked by VITEST_POOL_ID in
// pg-env.ts). Files named `*.perf.pg.test.ts` assert a timing budget, which
// other workers sharing the CPUs would skew, so they run alone, one file at a
// time, after every regular file (groupOrder 1). Never loosen a budget; move
// the budget test into a `*.perf.pg.test.ts` file instead.
const shared: NonNullable<TestProjectInlineConfiguration["test"]> = {
	environment: "node",
	globalSetup: ["src/test/pg-global-setup.ts"],
	setupFiles: ["src/test/pg-env.ts"],
	testTimeout: 30_000,
};

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
		projects: [
			{
				extends: true,
				test: {
					...shared,
					name: "pg",
					include: ["src/**/*.pg.test.ts"],
					exclude: ["**/node_modules/**", "src/**/*.perf.pg.test.ts"],
					// Fixed rather than "all cores": every worker adds a connection
					// pool and a database.
					maxWorkers: Number(process.env.PG_TEST_WORKERS ?? 4),
					sequence: { groupOrder: 0 },
				},
			},
			{
				extends: true,
				test: {
					...shared,
					name: "pg-perf",
					include: ["src/**/*.perf.pg.test.ts"],
					maxWorkers: 1,
					fileParallelism: false,
					sequence: { groupOrder: 1 },
				},
			},
		],
	},
});
