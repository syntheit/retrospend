/**
 * Global setup for `pnpm test:pg` (runs once, in the main vitest process).
 *
 * TEST_DATABASE_URL names a server (as its superuser) and a base database
 * name. Each run creates a template database `<base>_<random>_tpl` on that
 * server and applies every migration to it once with `prisma migrate deploy`
 * as retrospend_owner, after the owner bootstrap (scripts/db-owner) has made
 * the role and with the owner holding CREATE on the database for the length of
 * the migrations only, as a start gives it: the path of a new install, so a
 * migration that needs more than the owner's rights fails here. A second
 * database, `<base>_<random>_leg`, takes the path of an upgrade (migrated as the
 * superuser, then handed over) for the one test file that checks that, a third,
 * `_old`, does the same from a 0.4.x release (OLD_CUTOFF) so the owner has
 * migrations still to apply, and a fourth, `_scr`, is empty, for migrations of a
 * test's own (scratch-project.ts). The template is cloned once per vitest worker
 * (`<base>_<random>_w<n>`). Workers get the owner's URL, so `adminDb`
 * runs as retrospend_owner like the app in production; the superuser's URL is
 * a separate, opt-in value (`superUrl()` in pg-harness.ts). pg-env.ts picks a
 * worker's URLs by VITEST_POOL_ID. Everything is dropped afterwards. Test
 * files in one worker share a database, workers never do, and runs never share
 * state. Several worktrees can use one Postgres container as long as each
 * picks its own base name. The owner role is cluster-wide: every run derives
 * the same password from the superuser's, so runs share it harmlessly.
 */
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import {
	bootstrap,
	deriveOwnerPassword,
	migrateWithRecovery,
	ownerUrl,
	urlPassword,
} from "../../scripts/db-owner/index.mjs";
import { makeScratchProject } from "./scratch-project";

declare module "vitest" {
	export interface ProvidedContext {
		/** One database URL per worker as retrospend_owner, index = VITEST_POOL_ID - 1. */
		pgWorkerDatabaseUrls: string[];
		/** The same databases as the superuser, for tests that opt in. */
		pgWorkerSuperUrls: string[];
		/**
		 * How many objects a second owner bootstrap handed over on the template
		 * after the migrations ran as the owner: zero when every migration made
		 * its objects as retrospend_owner.
		 */
		pgFresh: { handedOverAfterMigrate: number };
		/**
		 * A database migrated as the superuser and then handed to the owner, the
		 * state of an upgraded install, and how many objects the handover moved.
		 */
		pgLegacy: { ownerUrl: string; superUrl: string; handedOver: number };
		/** An empty database with the owner bootstrap done, for migrations of a test's own. */
		pgScratch: { ownerUrl: string; superUrl: string };
		/**
		 * A database migrated as the superuser only up to OLD_CUTOFF, then handed
		 * over: a 0.4.x install, with migrations left to apply as the owner.
		 */
		pgOld: { ownerUrl: string; superUrl: string; cutoff: string };
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
	if (
		!Number.isInteger(maxWorkers) ||
		!maxWorkers ||
		maxWorkers < 1 ||
		maxWorkers > 16
	) {
		throw new Error(
			`PG_TEST_WORKERS must be an integer from 1 to 16, got "${process.env.PG_TEST_WORKERS}"`,
		);
	}
	return maxWorkers;
}

/**
 * The first migration the `_old` database does not get: the first one after
 * the last in applied.json (the migrations that had shipped to production when
 * this was written), so `_old` is a real 0.4.x install.
 */
export const OLD_CUTOFF = "20261025100000_budget_checkpoints";

/** Names of the template, the two upgrade fixtures and the per-worker databases for one run. */
export function runDatabaseNames(
	baseName: string,
	runId: string,
	workers: number,
): {
	template: string;
	legacy: string;
	old: string;
	scratch: string;
	workers: string[];
} {
	const stem = `${baseName}_${runId}`;
	const template = `${stem}_tpl`;
	const legacy = `${stem}_leg`;
	const old = `${stem}_old`;
	const scratch = `${stem}_scr`;
	const names = Array.from({ length: workers }, (_, i) => `${stem}_w${i + 1}`);
	for (const name of [template, legacy, old, scratch, ...names]) {
		if (Buffer.byteLength(name) > MAX_IDENTIFIER) {
			throw new Error(
				`Derived test database name "${name}" is longer than ${MAX_IDENTIFIER} bytes`,
			);
		}
	}
	return { template, legacy, old, scratch, workers: names };
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

	// Only names this run created get dropped: with a 4-hex run id another run
	// can draw the same names, and a failed CREATE must not drop its databases.
	const created: string[] = [];
	const create = async (client: Client, name: string, sql: string) => {
		await client.query(sql);
		created.push(name);
	};
	const dropRunDatabases = () =>
		withAdmin(async (client) => {
			// Workers first, then the template; each on its own so one failure
			// doesn't leak the rest. FORCE closes pool connections the workers
			// may still hold.
			for (const name of [...created].reverse()) {
				await client
					.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
					.catch((error: unknown) =>
						console.error(`could not drop ${name}:`, error),
					);
			}
		});

	// A database migrated as the superuser, the way every older release did.
	const migrateAsSuperuser = (databaseUrl: string, root?: string) =>
		migrateWithRecovery(databaseUrl, { root, log: () => undefined });
	const migrateBefore = async (databaseUrl: string, cutoff: string) => {
		// `prisma migrate deploy` only knows "all of them", so the old release's
		// state is made from a scratch project that links the migrations before
		// the cutoff and nothing else.
		const scratch = makeScratchProject({ realMigrationsBefore: cutoff });
		try {
			await migrateAsSuperuser(databaseUrl, scratch.dir);
		} finally {
			scratch.cleanup();
		}
	};
	const switched = async (
		databaseUrl: string,
		whileOwnerMayCreate?: (ownerUrl: string) => Promise<void>,
	) => {
		const result = await bootstrap(databaseUrl, {
			warn: (message) => console.error(message),
			whileOwnerMayCreate,
		});
		if (result.status !== "switched") {
			throw new Error(
				`The owner bootstrap did not run on the test database (${result.reason}); TEST_DATABASE_URL needs a superuser with a password`,
			);
		}
		return result;
	};

	let legacyHandedOver = 0;
	let freshHandedOver = -1;
	try {
		await withAdmin(async (client) => {
			await create(
				client,
				names.template,
				`CREATE DATABASE "${names.template}"`,
			);
			await create(client, names.legacy, `CREATE DATABASE "${names.legacy}"`);
			await create(client, names.old, `CREATE DATABASE "${names.old}"`);
			await create(client, names.scratch, `CREATE DATABASE "${names.scratch}"`);
		});
		// The template takes the path of a new install: the bootstrap, then
		// every migration as retrospend_owner with only the CREATE on the
		// database that a start gives it, taken back afterwards, so a migration
		// that needs more than the owner's rights fails here and not in
		// production.
		// The roles first, so that the migrations of the other databases (which
		// create retrospend_app if it is missing) never race the bootstrap.
		await switched(urlFor(names.template));
		const template = switched(urlFor(names.template), (url) =>
			migrateWithRecovery(url, { log: () => undefined }),
		);
		// The legacy database takes the path of an upgrade: migrated as the
		// superuser (every older release did), then the bootstrap hands all of
		// it to the owner. One test file reads it; nothing else touches it.
		// The old one is the same, from a 0.4.x release (before OLD_CUTOFF):
		// the owner then has migrations left to apply, the keystore one among
		// them, and the test applies them with a start. The scratch one is an
		// empty database for migrations of the tests' own.
		await Promise.all([
			template,
			migrateAsSuperuser(urlFor(names.legacy)),
			migrateBefore(urlFor(names.old), OLD_CUTOFF),
		]);
		legacyHandedOver = (await switched(urlFor(names.legacy))).changedObjects;
		await switched(urlFor(names.old));
		await switched(urlFor(names.scratch));
		// A second start: the migrations made everything as the owner, so there
		// is nothing left to hand over.
		freshHandedOver = (await switched(urlFor(names.template))).changedObjects;
		// A clone fails while anyone else is connected to the template; migrate
		// deploy and the bootstrap have exited and the workers have not started.
		// The clones run one after another because each one locks the template.
		// Postgres may still be tearing down the bootstrap's backends, so a
		// clone that sees them is retried.
		await withAdmin(async (client) => {
			for (const name of names.workers) {
				for (let attempt = 1; ; attempt++) {
					try {
						await create(
							client,
							name,
							`CREATE DATABASE "${name}" TEMPLATE "${names.template}"`,
						);
						break;
					} catch (error) {
						const code = (error as { code?: string }).code;
						if (code !== "55006" || attempt >= 20) throw error;
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				}
			}
		});
	} catch (error) {
		await dropRunDatabases();
		throw error;
	}

	const superPassword = urlPassword(baseUrl.toString());
	if (!superPassword) throw new Error("TEST_DATABASE_URL needs a password");
	const ownerPassword = deriveOwnerPassword(superPassword);
	project.provide(
		"pgWorkerDatabaseUrls",
		names.workers.map((name) => ownerUrl(urlFor(name), ownerPassword)),
	);
	project.provide("pgWorkerSuperUrls", names.workers.map(urlFor));
	project.provide("pgFresh", { handedOverAfterMigrate: freshHandedOver });
	project.provide("pgLegacy", {
		ownerUrl: ownerUrl(urlFor(names.legacy), ownerPassword),
		superUrl: urlFor(names.legacy),
		handedOver: legacyHandedOver,
	});
	project.provide("pgScratch", {
		ownerUrl: ownerUrl(urlFor(names.scratch), ownerPassword),
		superUrl: urlFor(names.scratch),
	});
	project.provide("pgOld", {
		ownerUrl: ownerUrl(urlFor(names.old), ownerPassword),
		superUrl: urlFor(names.old),
		cutoff: OLD_CUTOFF,
	});
	return dropRunDatabases;
}
