// The one-time handover of the objects in public and keystore to the owner, and
// the question that decides whether a database is brand-new.
import { bootstrapFile } from "./constants.mjs";
import { sleep } from "./database.mjs";

/**
 * One ALTER ... OWNER TO statement for every object in public and keystore
 * that retrospend_owner does not own yet (extension members excepted), in an
 * order that works. Empty once the handover is done.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }} client
 * @returns {Promise<string[]>}
 */
export async function handoverStatements(client) {
	const { rows } = await client.query(bootstrapFile("owner-handover.sql"));
	return rows.map((row) => String(row.ddl));
}

/**
 * Hands every object in public and keystore that someone else owns to the
 * owner role, one statement per transaction with a short lock_timeout and a
 * retry, so a busy table delays the start without holding others locked.
 * Returns how many objects it changed (zero once done).
 *
 * @param {import("pg").Client} client a superuser connection
 * @param {{ lockTimeout?: string, attempts?: number }} [options]
 */
export async function handover(client, options = {}) {
	const lockTimeout = options.lockTimeout ?? "3s";
	const attempts = options.attempts ?? 20;
	const statements = await handoverStatements(client);
	for (const ddl of statements) {
		for (let attempt = 1; ; attempt++) {
			try {
				await client.query("BEGIN");
				await client.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
				await client.query(ddl);
				await client.query("COMMIT");
				break;
			} catch (error) {
				await client.query("ROLLBACK");
				const code = /** @type {{ code?: string }} */ (error).code;
				if (code !== "55P03" || attempt >= attempts) throw error;
				await sleep(250);
			}
		}
	}
	return statements.length;
}

/**
 * Whether this database is a brand-new install: nothing in it that could carry
 * code, so nothing the owner could have planted (owner-fresh.sql), from the
 * catalogs only.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }} client
 * @returns {Promise<boolean>}
 */
export async function neverHandedOver(client) {
	const { rows } = await client.query(bootstrapFile("owner-fresh.sql"));
	return rows[0]?.fresh === true;
}
