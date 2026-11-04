/**
 * Global setup for `pnpm test:pg` (runs once, in the main vitest process).
 *
 * TEST_DATABASE_URL names a server and a base database name. Each run creates
 * a template database `<base>_<random>_tpl` on that server and applies every
 * migration to it once with `prisma migrate deploy` (the same path prod
 * takes). It then clones one database per vitest worker
 * (`<base>_<random>_w<n>`), hands the URLs to the workers (pg-env.ts picks one
 * by VITEST_POOL_ID) and drops everything afterwards. Test files in one worker
 * share a database, workers never do, and runs never share state. Several
 * worktrees can use one Postgres container as long as each picks its own base
 * name.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		/** One database URL per worker, index = VITEST_POOL_ID - 1. */
		pgWorkerDatabaseUrls: string[];
	}
}

// Postgres truncates identifiers at 63 bytes. A derived name is
// `<base>_<4 hex>` plus a suffix of at most 4 characters ("_tpl", "_w16").
const MAX_IDENTIFIER = 63;
const MAX_BASE_NAME = 54;

/**
 * Each worker holds a Pool of up to 20 connections to its own database, so
 * the count stays well under Postgres's default max_connections of 100.
 */
function workerCount(maxWorkers: number | undefined): number {
	if (!Number.isInteger(maxWorkers) || !maxWorkers || maxWorkers < 1 || maxWorkers > 16) {
		throw new Error(
			`PG_TEST_WORKERS must be an integer from 1 to 16, got "${process.env.PG_TEST_WORKERS}"`,
		);
	}
	return maxWorkers;
}

/** Names of the template and the per-worker databases for one run. */
export function runDatabaseNames(
	baseName: string,
	runId: string,
	workers: number,
): { template: string; workers: string[] } {
	const stem = `${baseName}_${runId}`;
	const template = `${stem}_tpl`;
	const names = Array.from({ length: workers }, (_, i) => `${stem}_w${i + 1}`);
	for (const name of [template, ...names]) {
		if (Buffer.byteLength(name) > MAX_IDENTIFIER) {
			throw new Error(
				`Derived test database name "${name}" is longer than ${MAX_IDENTIFIER} bytes`,
			);
		}
	}
	return { template, workers: names };
}

function maintenanceUrl(url: URL): string {
	const admin = new URL(url);
	admin.pathname = "/postgres";
	return admin.toString();
}

export default async function setup(project: TestProject) {
	try {
		return await createRunDatabase(project);
	} catch (error) {
		// vitest 5.0.5 crashes while source-mapping an error thrown from a
		// global setup file ("code.charCodeAt is not a function"), which hides
		// the real cause. Print it first; pg reports a refused connection as an
		// AggregateError whose own message is empty.
		const causes =
			error instanceof AggregateError
				? error.errors.map(String)
				: [String(error)];
		console.error(`pg test setup failed: ${causes.join("; ")}`);
		throw error;
	}
}

// The harness creates and drops databases, so it must never reach a real one.
// Dev (5434) and staging (5435) databases listen on localhost too, and the app
// ports (prod 1997, dev 2997, staging 3997) are never a test Postgres.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REFUSED_PORTS = new Set([5434, 5435, 1997, 2997, 3997]);
const TEST_NAME = /^retrospend_test(_|$)/;

/**
 * Validates TEST_DATABASE_URL and returns the server URL and base database
 * name. Throws unless it points at a local test Postgres with a
 * `retrospend_test` name.
 */
export function parseTestDatabaseUrl(raw: string | undefined): {
	baseUrl: URL;
	baseName: string;
} {
	if (!raw) {
		throw new Error(
			"TEST_DATABASE_URL is not set. Start docker-compose.test.yml and point it at a database name unique to your worktree.",
		);
	}

	const baseUrl = new URL(raw);
	if (!LOCAL_HOSTS.has(baseUrl.hostname)) {
		throw new Error(
			`TEST_DATABASE_URL must point at localhost, got host "${baseUrl.hostname}"`,
		);
	}
	const port = Number(baseUrl.port || 5432);
	if (REFUSED_PORTS.has(port)) {
		throw new Error(
			`TEST_DATABASE_URL port ${port} belongs to a dev, staging or prod service, not the test Postgres`,
		);
	}

	const baseName = baseUrl.pathname.slice(1);
	if (
		!TEST_NAME.test(baseName) ||
		!/^[a-z0-9_]+$/.test(baseName) ||
		baseName.length > MAX_BASE_NAME
	) {
		throw new Error(
			`TEST_DATABASE_URL database name must start with retrospend_test, use lowercase [a-z0-9_] and be at most ${MAX_BASE_NAME} characters, got "${baseName}"`,
		);
	}
	return { baseUrl, baseName };
}

async function createRunDatabase(project: TestProject) {
	const { baseUrl, baseName } = parseTestDatabaseUrl(
		process.env.TEST_DATABASE_URL,
	);

	const names = runDatabaseNames(
		baseName,
		randomBytes(2).toString("hex"),
		workerCount(project.config.maxWorkers),
	);
	const urlFor = (name: string) => {
		const url = new URL(baseUrl);
		url.pathname = `/${name}`;
		return url.toString();
	};

	const withAdmin = async <T>(run: (client: Client) => Promise<T>) => {
		const client = new Client({ connectionString: maintenanceUrl(baseUrl) });
		await client.connect();
		try {
			return await run(client);
		} finally {
			await client.end();
		}
	};

	const dropRunDatabases = () =>
		withAdmin(async (client) => {
			// FORCE closes pool connections the workers may still hold.
			for (const name of [...names.workers, names.template]) {
				await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			}
		});

	try {
		await withAdmin((client) =>
			client.query(`CREATE DATABASE "${names.template}"`),
		);
		execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
			env: { ...process.env, DATABASE_URL: urlFor(names.template) },
			stdio: ["ignore", "ignore", "inherit"],
		});
		// A clone fails while anyone else is connected to the template; migrate
		// deploy has exited and the workers have not started. The clones run one
		// after another because each one locks the template.
		await withAdmin(async (client) => {
			for (const name of names.workers) {
				await client.query(
					`CREATE DATABASE "${name}" TEMPLATE "${names.template}"`,
				);
			}
		});
	} catch (error) {
		await dropRunDatabases();
		throw error;
	}

	project.provide("pgWorkerDatabaseUrls", names.workers.map(urlFor));
	return dropRunDatabases;
}
