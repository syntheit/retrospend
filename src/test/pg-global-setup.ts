/**
 * Global setup for `pnpm test:pg` (runs once, in the main vitest process).
 *
 * TEST_DATABASE_URL names a server and a base database name. Each run creates
 * a fresh database called `<base>_<random>` on that server, applies every
 * migration with `prisma migrate deploy` (the same path prod takes), hands the
 * URL to the test workers and drops the database afterwards. Runs never share
 * state, and several worktrees can use one Postgres container as long as each
 * picks its own base name.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		pgDatabaseUrl: string;
	}
}

// Postgres truncates identifiers at 63 bytes; leave room for "_" + 8 hex.
const MAX_BASE_NAME = 54;

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

	const runName = `${baseName}_${randomBytes(4).toString("hex")}`;
	const runUrl = new URL(baseUrl);
	runUrl.pathname = `/${runName}`;

	const admin = new Client({ connectionString: maintenanceUrl(baseUrl) });
	await admin.connect();
	try {
		await admin.query(`CREATE DATABASE "${runName}"`);
	} finally {
		await admin.end();
	}

	const dropRunDatabase = async () => {
		const client = new Client({ connectionString: maintenanceUrl(baseUrl) });
		await client.connect();
		try {
			// FORCE closes pool connections the workers may still hold.
			await client.query(`DROP DATABASE IF EXISTS "${runName}" WITH (FORCE)`);
		} finally {
			await client.end();
		}
	};

	try {
		execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
			env: { ...process.env, DATABASE_URL: runUrl.toString() },
			stdio: ["ignore", "ignore", "inherit"],
		});
	} catch (error) {
		await dropRunDatabase();
		throw error;
	}

	project.provide("pgDatabaseUrl", runUrl.toString());
	return dropRunDatabase;
}
