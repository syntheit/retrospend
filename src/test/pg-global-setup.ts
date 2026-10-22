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
	const raw = process.env.TEST_DATABASE_URL;
	if (!raw) {
		throw new Error(
			"TEST_DATABASE_URL is not set. Start docker-compose.test.yml and point it at a database name unique to your worktree.",
		);
	}

	const baseUrl = new URL(raw);
	const baseName = baseUrl.pathname.slice(1) || "retrospend_test";
	if (!/^[a-z0-9_]+$/.test(baseName) || baseName.length > MAX_BASE_NAME) {
		throw new Error(
			`TEST_DATABASE_URL database name must be lowercase [a-z0-9_] and at most ${MAX_BASE_NAME} characters, got "${baseName}"`,
		);
	}

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
