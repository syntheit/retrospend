// The migrations of a brand-new install, as a one-shot role of their own.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { OWNER_ROLE } from "./constants.mjs";
import { connect, databaseIdentifier } from "./database.mjs";
import { neverHandedOver } from "./handover.mjs";
import { roleUrl, scramVerifier } from "./password.mjs";

/** The start of every one-shot migration role's name. */
export const MIGRATOR_PREFIX = "retrospend_migrator";

/**
 * The migration role of a database. The role is cluster-wide, so each database
 * gets its own (a hash of its name): two installs on one cluster, or two test
 * runs, never meet in one role.
 *
 * @param {string} databaseName
 */
export function migratorRoleName(databaseName) {
	const hash = createHash("sha256").update(databaseName).digest("hex");
	return `${MIGRATOR_PREFIX}_${hash.slice(0, 12)}`;
}

/**
 * Removes a migration role and everything it was given, from the catalogs
 * only: its sessions end, CREATE on the database is revoked, what it owns
 * goes to the owner (REASSIGN OWNED runs no code, and rewrites the owner and
 * grantor entries of every ACL), whatever else names it (default privileges,
 * grants) is dropped, and the role goes. Safe when it does not exist.
 *
 * @param {pg.Client} client a superuser connection
 * @param {string} role
 */
async function removeMigrator(client, role) {
	const { rows } = await client.query(
		"SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
		[role],
	);
	if (rows.length === 0) return;
	const name = client.escapeIdentifier(role);
	const database = await databaseIdentifier(client);
	await client.query(`ALTER ROLE ${name} NOLOGIN`);
	await client.query(
		"SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE usename = $1 AND pid <> pg_catalog.pg_backend_pid()",
		[role],
	);
	await client.query(`REVOKE CREATE ON DATABASE ${database} FROM ${name}`);
	const owner = await client.query(
		"SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
		[OWNER_ROLE],
	);
	if (owner.rows.length > 0) {
		await client.query(`REASSIGN OWNED BY ${name} TO ${OWNER_ROLE}`);
	}
	await client.query(`DROP OWNED BY ${name}`);
	await client.query(`DROP ROLE ${name}`);
}

/**
 * removeMigrator, and once more on a new connection if the open one died while
 * the migrations ran.
 *
 * @param {pg.Client} admin
 * @param {string} databaseUrl
 * @param {string} role
 */
export async function removeMigratorSurely(admin, databaseUrl, role) {
	try {
		await removeMigrator(admin, role);
	} catch {
		const again = await connect(databaseUrl);
		try {
			await removeMigrator(again, role);
		} finally {
			await again.end().catch(() => undefined);
		}
	}
}

/**
 * The migrations of a brand-new install, as a one-shot role of their own, so
 * that the owner never holds CREATE on the database and no session of the owner
 * can use the window. The role (a random password for this start, never
 * logged) holds CREATE on the database and owns public and keystore while the
 * callback runs; it is not the owner and not a member of it, and nothing the
 * owner could use exists in the database yet. Afterwards, in a `finally`, all it
 * made goes to the owner and the role is dropped.
 *
 * Returns false, without running the callback, when the database turns out not
 * to be empty once the schemas have changed hands: something got in between the
 * decision and now.
 *
 * @param {pg.Client} admin a superuser connection
 * @param {string} databaseUrl
 * @param {string} role the migration role's name
 * @param {(migratorUrl: string) => Promise<void>} run
 * @returns {Promise<boolean>}
 */
export async function withCreateWindow(admin, databaseUrl, role, run) {
	const password = randomBytes(24).toString("hex");
	const name = admin.escapeIdentifier(role);
	const database = await databaseIdentifier(admin);
	try {
		await admin.query("BEGIN");
		await admin.query("SET LOCAL log_statement = 'none'");
		await admin.query(
			`CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT NOREPLICATION BYPASSRLS PASSWORD ${admin.escapeLiteral(scramVerifier(password))}`,
		);
		// An old migration says GRANT retrospend_app TO CURRENT_USER.
		await admin.query(`GRANT retrospend_app TO ${name} WITH ADMIN OPTION`);
		await admin.query("COMMIT");
		await admin.query(`GRANT CREATE ON DATABASE ${database} TO ${name}`);
		await admin.query(`ALTER SCHEMA public OWNER TO ${name}`);
		await admin.query(`ALTER SCHEMA keystore OWNER TO ${name}`);
		// The owner owned keystore until now: look again, from the catalogs.
		if (!(await neverHandedOver(admin))) return false;
		await run(roleUrl(databaseUrl, role, password));
		return true;
	} catch (error) {
		await admin.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		await removeMigratorSurely(admin, databaseUrl, role);
	}
}
