import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	defineConfig,
	type TestProjectInlineConfiguration,
} from "vitest/config";

// `pnpm test:pg`: tests that need a real Postgres (TEST_DATABASE_URL).
// vitest.config.ts excludes these, so `pnpm test` runs without a database.
//
// Three projects share one setup. The root `globalSetup` runs once per run
// (Vitest strips it from projects that extend this file) and provides the
// worker databases to every project; `getProvidedContext()` merges the root's
// context into each project's `inject()`. Regular files run in parallel, one
// cloned database per worker (pg-global-setup.ts, picked by VITEST_POOL_ID in
// pg-env.ts). The perf project has one worker, so it reuses w1 once the
// parallel group has finished. Files named `*.perf.pg.test.ts` assert a
// timing budget, which other workers sharing the CPUs would skew, so they run
// alone, one file at a time, after every regular file and the quiet project
// (groupOrder 2). Never loosen a budget; move the budget test into a
// `*.perf.pg.test.ts` file instead.
// The quiet project (groupOrder 1, one worker, after the parallel group) runs
// the files in QUIET_FILES alone. A sync position is a cluster-wide
// transaction id, and a pull ends below the oldest transaction open when it
// reads. With the parallel workers writing, some other worker's transaction is
// nearly always open, so a device is legitimately `behind` the server's read
// and a check that must settle never does. Only a file whose assertion is
// "the device caught up to the server's read" belongs in the list; a file that
// waits for row counts (parity.pg.test.ts) does not.
//
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

const QUIET_FILES = [
	"src/test/parity/compare-proof.pg.test.ts",
	"src/test/parity/category-merge-sync.pg.test.ts",
];
for (const file of QUIET_FILES)
	if (!existsSync(file))
		throw new Error(`QUIET_FILES names a missing file: ${file}`);

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
		globalSetup: ["src/test/pg-global-setup.ts"],
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
						...QUIET_FILES,
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
					name: "pg-quiet",
					include: QUIET_FILES,
					exclude: keyStateFiles,
					maxWorkers: 1,
					fileParallelism: false,
					sequence: { groupOrder: 1 },
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
					sequence: { groupOrder: 2 },
				},
			},
		],
	},
});
