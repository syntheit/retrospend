/**
 * What a pg test run leaves behind when it is killed, and how the next run
 * cleans it up without touching a run that is still alive.
 *
 * A run owns the databases `<stem>_tpl`, `_leg`, `_old`, `_scr`, `_sc2`,
 * `_sc3` and `_w1`..`_w16` (stem = `<base>_<run id>`), and, for the seconds a
 * brand-new install's migrations take, the one-shot migration role of each
 * (scripts/db-owner/window.mjs). A run killed mid-migration leaks the
 * databases and that cluster-wide role, which then fails the owner-role tests
 * of every later run.
 *
 * Liveness is one session-level advisory lock per run on the maintenance
 * database, keyed by the stem and held by a connection that lives as long as
 * the run: when the process dies, Postgres frees the lock. A stem whose lock
 * can be taken is dead. A run takes its lock before it creates anything, so a
 * database that exists always belongs to a held lock or a dead run, and a
 * sweep never reaches a run that is starting up.
 *
 * The template database carries a comment with the stem. That comment is how
 * a sweep finds runs, and a database without it (a run of a harness that
 * predates the lock, which holds none) is never touched: a name that merely
 * looks like a run's could belong to a live one. The comment is set right
 * after the template is created (createMarkedTemplate); a kill between the
 * two leaves one empty database and no role, nothing a test reads. The
 * template is dropped last, so a sweep that is interrupted finds the run
 * again.
 *
 * A run whose lock connection is lost has no protection any more: a sweep may
 * drop its databases at any time. RunLock remembers a lost connection and
 * assertHeld throws, so the run fails instead of passing on borrowed time. The
 * lock is per session, so TEST_DATABASE_URL must be a direct connection to
 * Postgres: a pooler in transaction mode hands the session to others.
 */
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
	migratorRoleName,
	removeMigratorSurely,
} from "../../scripts/db-owner/index.mjs";

/** The most workers a run can have; workerCount in pg-global-setup.ts enforces it. */
export const MAX_WORKERS = 16;

/** What a run's template database is commented with, followed by the stem. */
export const RUN_MARKER = "retrospend pg test run ";

type Quiet = { log?: (message: string) => void };

/** The databases of one run, from its stem. The only place the suffixes are written. */
export function runNames(stem: string, workers: number) {
	return {
		template: `${stem}_tpl`,
		legacy: `${stem}_leg`,
		old: `${stem}_old`,
		scratch: `${stem}_scr`,
		scratch2: `${stem}_sc2`,
		scratch3: `${stem}_sc3`,
		workers: Array.from({ length: workers }, (_, i) => `${stem}_w${i + 1}`),
	};
}

function allDatabases(stem: string): string[] {
	const names = runNames(stem, MAX_WORKERS);
	const { workers, ...rest } = names;
	return [...Object.values(rest), ...workers];
}

/** The migration roles a run can own, one per database it can bootstrap. */
export function migratorRolesOfRun(stem: string): string[] {
	return allDatabases(stem).map(migratorRoleName);
}

/** A signed 64 bit key for the run's advisory lock, as text for the bigint parameter. */
function lockKey(stem: string): string {
	return createHash("sha256")
		.update(`retrospend pg test run lock ${stem}`)
		.digest()
		.readBigInt64BE(0)
		.toString();
}

/** The migration roles of the databases a test migrates for itself (scratch-project.ts). */
export function scratchMigratorRoles(stem: string): string[] {
	const { scratch, scratch2, scratch3 } = runNames(stem, 0);
	return [scratch, scratch2, scratch3].map(migratorRoleName);
}

/**
 * The connection that holds a run's lock for the whole run. A connection that
 * errors or ends is remembered, never forgotten: the lock went with it.
 */
export class RunLock {
	readonly client: Client;
	private lostBecause: string | null = null;

	constructor(url: string) {
		this.client = new Client({ connectionString: url });
		const lose = (why: string) => {
			if (this.lostBecause !== null) return;
			this.lostBecause = why;
			console.error(`pg test run lock lost: ${why}`);
		};
		this.client.on("error", (error) => lose(String(error)));
		this.client.on("end", () => lose("the connection ended"));
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	/** Takes the run's lock. False when another session holds it. */
	take(stem: string): Promise<boolean> {
		return tryLockRun(this.client, stem);
	}

	/**
	 * Throws unless this session still holds the run's lock: fail closed on a
	 * lost connection, a released lock or any error asking.
	 */
	async assertHeld(stem: string): Promise<void> {
		if (this.lostBecause !== null) {
			throw new Error(
				`the lock of test run ${stem} was lost: ${this.lostBecause}`,
			);
		}
		const { rowCount } = await this.client.query(
			`SELECT 1 FROM pg_catalog.pg_locks
			  WHERE locktype = 'advisory' AND pid = pg_catalog.pg_backend_pid()
			    AND granted AND objsubid = 1
			    AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
			[lockKey(stem)],
		);
		if (rowCount !== 1) {
			throw new Error(`the lock of test run ${stem} is no longer held`);
		}
	}

	/** Lets go of the lock by closing the session. */
	async close(): Promise<void> {
		await this.client.end().catch(() => undefined);
	}
}

/** Takes the run's lock for this session. False when a live run holds it. */
export async function tryLockRun(
	client: Client,
	stem: string,
): Promise<boolean> {
	const { rows } = await client.query<{ got: boolean }>(
		"SELECT pg_try_advisory_lock($1::bigint) AS got",
		[lockKey(stem)],
	);
	return rows[0]?.got === true;
}

export async function unlockRun(client: Client, stem: string): Promise<void> {
	await client.query("SELECT pg_advisory_unlock($1::bigint)", [lockKey(stem)]);
}

/**
 * Creates the run's template and marks it in one step: when the mark cannot be
 * set the database is dropped again, so a database a sweep cannot find never
 * outlives the call. Returns after both.
 */
export async function createMarkedTemplate(
	client: Client,
	stem: string,
	marker = RUN_MARKER,
): Promise<void> {
	const template = client.escapeIdentifier(runNames(stem, 0).template);
	await client.query(`CREATE DATABASE ${template}`);
	try {
		await markRun(client, stem, marker);
	} catch (error) {
		await client.query(`DROP DATABASE IF EXISTS ${template} WITH (FORCE)`);
		throw error;
	}
}

/** Marks the run's template (already created) so that a sweep can find the run. */
export async function markRun(
	client: Client,
	stem: string,
	marker = RUN_MARKER,
): Promise<void> {
	await client.query(
		`COMMENT ON DATABASE ${client.escapeIdentifier(runNames(stem, 0).template)} IS ${client.escapeLiteral(marker + stem)}`,
	);
}

/** The stems of every marked run on the cluster, live or dead. */
export async function markedRuns(
	client: Client,
	marker = RUN_MARKER,
): Promise<string[]> {
	const { rows } = await client.query<{ name: string; note: string }>(
		`SELECT d.datname AS name, pg_catalog.shobj_description(d.oid, 'pg_database') AS note
		   FROM pg_catalog.pg_database d
		  WHERE pg_catalog.shobj_description(d.oid, 'pg_database') LIKE $1
		  ORDER BY 1`,
		[`${marker.replace(/[\\%_]/g, "\\$&")}%`],
	);
	// The comment must agree with the database it is on: a copied comment
	// names a run that is not this one.
	return rows
		.map((row) => ({ stem: row.note.slice(marker.length), name: row.name }))
		.filter(({ stem, name }) => name === runNames(stem, 0).template)
		.map(({ stem }) => stem);
}

/** Which marked runs hold their lock and which do not, asked without keeping a lock. */
export async function classifyRuns(
	client: Client,
	marker = RUN_MARKER,
): Promise<{ live: string[]; dead: string[] }> {
	const live: string[] = [];
	const dead: string[] = [];
	for (const stem of await markedRuns(client, marker)) {
		if (await tryLockRun(client, stem)) {
			await unlockRun(client, stem);
			dead.push(stem);
		} else {
			live.push(stem);
		}
	}
	return { live, dead };
}

/**
 * The migration roles that exist, split by whether the run they belong to
 * holds its lock. A role that is in neither list belongs to no marked run.
 */
export async function migratorRolesByLiveness(
	client: Client,
	marker = RUN_MARKER,
): Promise<{ live: string[]; dead: string[] }> {
	const { live, dead } = await classifyRuns(client, marker);
	const existing = async (stems: string[]) => {
		const { rows } = await client.query<{ name: string }>(
			"SELECT rolname AS name FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[]) ORDER BY 1",
			[stems.flatMap(migratorRolesOfRun)],
		);
		return rows.map((row) => row.name);
	};
	return { live: await existing(live), dead: await existing(dead) };
}

function databaseUrl(maintenanceUrl: string, name: string): string {
	const url = new URL(maintenanceUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

/**
 * Removes one dead run whose lock this session holds: every database but the
 * template, then its migration roles (from inside the template, where the
 * objects they own still are, with the removal a start does, window.mjs), then
 * the template.
 */
async function removeRun(
	admin: Client,
	maintenanceUrl: string,
	stem: string,
): Promise<void> {
	const names = runNames(stem, MAX_WORKERS);
	const { template, workers, ...rest } = names;
	for (const name of [...workers].reverse().concat(Object.values(rest))) {
		await admin.query(
			`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`,
		);
	}
	const { rows } = await admin.query<{ name: string }>(
		"SELECT rolname AS name FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])",
		[migratorRolesOfRun(stem)],
	);
	if (rows.length > 0) {
		const url = databaseUrl(maintenanceUrl, template);
		const inTemplate = new Client({ connectionString: url });
		await inTemplate.connect();
		try {
			await inTemplate.query("SET search_path = pg_catalog, pg_temp");
			for (const { name } of rows) {
				await removeMigratorSurely(inTemplate, url, name);
			}
		} finally {
			await inTemplate.end().catch(() => undefined);
		}
	}
	await admin.query(
		`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(template)} WITH (FORCE)`,
	);
}

/**
 * Removes every dead marked run (databases and migration roles) and leaves
 * every live one alone. `admin` is a superuser connection to the maintenance
 * database; `maintenanceUrl` is its URL. A run that cannot be removed is
 * logged and left for the next sweep. Returns the stems it removed.
 */
export async function sweepDeadRuns(
	admin: Client,
	maintenanceUrl: string,
	options: Quiet & { marker?: string } = {},
): Promise<string[]> {
	const log = options.log ?? ((m: string) => console.error(m));
	const removed: string[] = [];
	for (const stem of await markedRuns(admin, options.marker)) {
		if (!(await tryLockRun(admin, stem))) continue;
		try {
			await removeRun(admin, maintenanceUrl, stem);
			removed.push(stem);
		} catch (error) {
			log(`could not remove the leftovers of test run ${stem}: ${error}`);
		} finally {
			await unlockRun(admin, stem).catch(() => undefined);
		}
	}
	return removed;
}
