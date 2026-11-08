// Connections to the database as the superuser, and what a racing start needs.
import pg from "pg";

/** SQLSTATEs a racing bootstrap on a shared cluster can raise; worth a retry. */
const RETRYABLE = new Set(["XX000", "42710", "23505", "40001", "40P01"]);

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {() => Promise<T>} work
 * @param {number} attempts
 * @returns {Promise<T>}
 * @template T
 */
export async function retrying(work, attempts = 6) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await work();
		} catch (error) {
			const code = /** @type {{ code?: string }} */ (error).code ?? "";
			if (attempt >= attempts || !RETRYABLE.has(code)) throw error;
			await sleep(150 * attempt + Math.floor(Math.random() * 150));
		}
	}
}

/**
 * Connects as given, with the search_path a superuser statement can trust.
 *
 * @param {string} connectionString
 */
export async function connect(connectionString) {
	const client = new pg.Client({
		connectionString,
		connectionTimeoutMillis: 10_000,
	});
	await client.connect();
	await client.query("SET search_path = pg_catalog, pg_temp");
	return client;
}

/**
 * The name of the database `client` is connected to.
 *
 * @param {pg.Client} client
 */
export async function databaseName(client) {
	const { rows } = await client.query(
		"SELECT pg_catalog.current_database() AS name",
	);
	return String(rows[0]?.name);
}

/**
 * The quoted name of the database `client` is connected to.
 *
 * @param {pg.Client} client
 */
export async function databaseIdentifier(client) {
	const { rows } = await client.query(
		"SELECT pg_catalog.quote_ident(pg_catalog.current_database()) AS name",
	);
	return String(rows[0]?.name);
}
