import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	defineConfig,
	type TestProjectInlineConfiguration,
} from "vitest/config";

// `pnpm test:pg`: tests that need a real Postgres (TEST_DATABASE_URL).
// vitest.config.ts excludes these, so `pnpm test` runs without a database.
//
// Two projects share one setup. The root `globalSetup` runs once per run
// (Vitest strips it from projects that extend this file) and provides the
// worker databases to every project; `getProvidedContext()` merges the root's
// context into each project's `inject()`. Regular files run in parallel, one
// cloned database per worker (pg-global-setup.ts, picked by VITEST_POOL_ID in
// pg-env.ts). The perf project has one worker, so it reuses w1 once the
// parallel group has finished. Files named `*.perf.pg.test.ts` assert a
// timing budget, which other workers sharing the CPUs would skew, so they run
// alone, one file at a time, after every regular file (groupOrder 1). Never
// loosen a budget; move the budget test into a `*.perf.pg.test.ts` file
// instead.
// Fixed rather than "all cores": every worker adds a connection pool and a
// database. The root setup sizes its clones from this root `maxWorkers`; the
// perf project never needs more than the first of them.
const workers = Number(process.env.PG_TEST_WORKERS ?? 4);

// `PG_TEST_SEALED=1`: the sealed suite (src/test/sealed-sweep.ts), every file
// with sealing on, except the files listed in sealed-suite.exclude.json: they
// set a master key, sealing or the epoch themselves, which the suite's would
// override. src/test/sealed-suite.test.ts keeps the list exact.
const keyStateFiles =
	process.env.PG_TEST_SEALED === "1"
		? Object.keys(
				JSON.parse(
					readFileSync("src/test/sealed-suite.exclude.json", "utf8"),
				) as Record<string, string>,
			)
		: [];

const shared: NonNullable<TestProjectInlineConfiguration["test"]> = {
	environment: "node",
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
		globalSetup: [
			"src/test/pg-global-setup.ts",
			"src/test/money/number-writes-setup.ts",
		],
		maxWorkers: workers,
		projects: [
			{
				extends: true,
				test: {
					...shared,
					name: "pg",
					include: ["src/**/*.pg.test.ts"],
					exclude: [
						"**/node_modules/**",
						"src/**/*.perf.pg.test.ts",
						...keyStateFiles,
					],
					maxWorkers: workers,
					sequence: { groupOrder: 0 },
				},
			},
			{
				extends: true,
				test: {
					...shared,
					name: "pg-perf",
					include: ["src/**/*.perf.pg.test.ts"],
					exclude: keyStateFiles,
					maxWorkers: 1,
					fileParallelism: false,
					sequence: { groupOrder: 1 },
				},
			},
		],
	},
});
