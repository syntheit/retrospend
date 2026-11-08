// The owner role: making it, checking what it holds, signing in as it, and its
// password. Superuser connections only; nothing the owner owns is read.
import pg from "pg";
import { bootstrapFile, OWNER_ROLE } from "./constants.mjs";
import { retrying } from "./database.mjs";
import { scramVerifier } from "./password.mjs";

/**
 * The role, its grants, the extension and the schema (owner-role.sql). A
 * normal start writes nothing.
 *
 * @param {pg.Client} client a superuser connection
 */
export async function createOwnerRole(client) {
	await retrying(async () => {
		try {
			await client.query(bootstrapFile("owner-role.sql"));
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	});
}

/**
 * What is wrong with retrospend_owner and retrospend_app, read from the
 * catalogs only (owner-verify.sql). Empty when all is well.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }} client
 * @returns {Promise<string[]>}
 */
export async function ownerProblems(client) {
	const { rows } = await client.query(bootstrapFile("owner-verify.sql"));
	return rows.map((row) => String(row.problem));
}

/**
 * Checks the owner and the app role from the catalogs. When something is
 * wrong it removes what it can (role memberships by the grantor that made them,
 * the attributes), says so loudly, and throws, so the container does not start
 * on a role that held more than it should. The next start finds it clean. A
 * superuser connection is needed to remove anything; nothing the owner owns is
 * read.
 *
 * @param {pg.Client} client a superuser connection
 * @param {(message: string) => void} warn
 */
export async function enforceOwnerRole(client, warn) {
	const found = await ownerProblems(client);
	if (found.length === 0) return;
	warn(
		`WARNING: ${OWNER_ROLE} or retrospend_app holds more than it may (${found.join("; ")}). This should never happen: something with the owner's rights may have granted it. Removing it and stopping; check the database for what ran as ${OWNER_ROLE}.`,
	);
	const { rows } = await client.query(bootstrapFile("owner-unsafe-grants.sql"));
	for (const row of rows) await client.query(String(row.ddl));
	if (found.some((problem) => problem.startsWith("attribute "))) {
		await client.query(
			`ALTER ROLE ${OWNER_ROLE} NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION`,
		);
	}
	const left = await ownerProblems(client);
	throw new Error(
		left.length === 0
			? `${OWNER_ROLE} held more than it may (${found.join("; ")}); it was removed, start again`
			: `${OWNER_ROLE} holds more than it may and it could not be removed: ${left.join("; ")}`,
	);
}

/**
 * Whether `connectionString` signs in. A role that signs in but holds more than
 * it may is not a login problem: that throws.
 *
 * @param {string} connectionString
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function ownerLogin(connectionString) {
	const client = new pg.Client({
		connectionString,
		connectionTimeoutMillis: 10_000,
	});
	try {
		await client.connect();
	} catch (error) {
		await client.end().catch(() => undefined);
		return {
			ok: false,
			reason: /** @type {Error} */ (error).message ?? String(error),
		};
	}
	try {
		const problems = await ownerProblems(client);
		if (problems.length > 0) {
			throw new Error(
				`${OWNER_ROLE} holds more than it may: ${problems.join("; ")}`,
			);
		}
		return { ok: true };
	} finally {
		await client.end().catch(() => undefined);
	}
}

/**
 * Sets the owner's password to a SCRAM verifier of `password`. Statement
 * logging is off for it (the verifier is not the password, but it is the
 * thing to guess against).
 *
 * @param {pg.Client} client a superuser connection
 * @param {string} password
 */
async function setOwnerPassword(client, password) {
	const verifier = scramVerifier(password);
	await retrying(async () => {
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL log_statement = 'none'");
			await client.query(
				`ALTER ROLE ${OWNER_ROLE} PASSWORD ${client.escapeLiteral(verifier)}`,
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	});
}

/**
 * Whether the connection's user is a superuser.
 *
 * @param {pg.Client} client
 */
export async function isSuperuser(client) {
	const { rows } = await client.query(
		"SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
	);
	return rows[0]?.rolsuper === true;
}

/**
 * The owner role, ready to sign in with `ownerPassword`: made and repaired,
 * checked from the catalogs (refusing to go on if it holds too much), and its
 * password set only if signing in with it fails.
 *
 * @param {pg.Client} admin a superuser connection
 * @param {string} url the owner's URL
 * @param {string} ownerPassword
 * @param {(message: string) => void} warn
 */
export async function readyOwner(admin, url, ownerPassword, warn) {
	await createOwnerRole(admin);
	await enforceOwnerRole(admin, warn);
	let login = await ownerLogin(url);
	if (!login.ok) {
		await setOwnerPassword(admin, ownerPassword);
		login = await ownerLogin(url);
	}
	if (!login.ok) {
		throw new Error(
			`The ${OWNER_ROLE} role cannot sign in with its password: ${login.reason}`,
		);
	}
}
