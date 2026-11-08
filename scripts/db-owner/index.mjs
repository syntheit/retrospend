// The app stops connecting to Postgres as the superuser.
//
// With a superuser URL in DATABASE_URL, a start runs prisma/bootstrap/owner-role.sql
// as the superuser (creates retrospend_owner, hands it the objects), checks the
// owner can sign in, and gives everything after that the owner's URL: the
// migrations, the grants file and the app. The owner holds CREATE on the
// database only on a brand-new install, and only while `prisma migrate deploy`
// runs (prepare); the superuser connection stays open for that long to take it
// back. Upgrades never grant it. retrospend_owner is not a
// superuser, so SQL that escapes the row-level security role lands on a role
// that cannot read files, run programs, create roles or touch other databases.
//
// This file is plain Node (the image has `pg` and nothing to compile with) and
// is imported by docker-entrypoint.sh through cli.mjs and by the pg test
// harness. The owner's password is derived from the superuser's, so no new
// secret needs configuring: see deriveOwnerPassword.

import { spawn } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const OWNER_ROLE = "retrospend_owner";

const here = dirname(fileURLToPath(import.meta.url));
/** The project root: /app in the image. */
export const PROJECT_ROOT = join(here, "..", "..");
const BOOTSTRAP_DIR = join(PROJECT_ROOT, "prisma", "bootstrap");

/** Environment variables the app process may see; see buildAppEnv. */
export const APP_ENV_NAMES = [
	// The shell and the platform
	"PATH",
	"HOME",
	"HOSTNAME",
	"PORT",
	"TZ",
	"LANG",
	"LC_ALL",
	"NODE_ENV",
	"NODE_OPTIONS",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"NEXT_TELEMETRY_DISABLED",
	"NEXT_RUNTIME",
	// What the app reads (src/env.js and the other process.env readers)
	"DATABASE_URL",
	"AUTH_SECRET",
	"BETTER_AUTH_SECRET",
	"SIDECAR_URL",
	"WORKER_URL",
	"IMPORTER_URL",
	"WORKER_API_KEY",
	"PUBLIC_URL",
	"TRUSTED_ORIGINS",
	"SHOW_LANDING_PAGE",
	"ENABLE_LEGAL_PAGES",
	"DEFAULT_TIME_ZONE",
	"OPENROUTER_API_KEY",
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASSWORD",
	"EMAIL_FROM",
	"UPLOAD_DIR",
	"EXPORT_DIR",
	"UNSUBSCRIBE_SECRET",
	"PUSH_ENDPOINT_ALLOW_HOSTS",
	"DATA_MASTER_KEY",
	"DATA_MASTER_KEY_FILE",
	"APNS_KEY_ID",
	"APNS_TEAM_ID",
	"APNS_BUNDLE_ID",
	"APNS_KEY",
	"APNS_KEY_FILE",
	"VAPID_PUBLIC_KEY",
	"VAPID_PRIVATE_KEY",
	"VAPID_SUBJECT",
	"FCM_PROJECT_ID",
	"FCM_SERVICE_ACCOUNT",
	"FCM_SERVICE_ACCOUNT_FILE",
	"ANDROID_APP_CERT_SHA256",
	"SECURITY_CONTACT",
];
/** Any variable starting with one of these reaches the app too. */
const APP_ENV_PREFIXES = ["NEXT_PUBLIC_", "LC_"];
/** Set by the base image or by us; dropping them is not worth a warning. */
const QUIET_DROPS = new Set([
	"NODE_VERSION",
	"YARN_VERSION",
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	"DATABASE_OWNER_PASSWORD",
	"POSTGRES_USER",
	"POSTGRES_PASSWORD",
	"POSTGRES_DB_NAME",
	"POSTGRES_DB",
]);

/** @param {string} name */
function isAppEnvName(name) {
	return (
		APP_ENV_NAMES.includes(name) ||
		APP_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
	);
}

/**
 * The password of the owner role: hex(HMAC-SHA256(key = the superuser's
 * password, message = "retrospend_owner")). The key is the password as the
 * URL spells it after percent-decoding, as UTF-8 bytes. Anyone holding the
 * superuser password can derive it, which they could not gain anything from;
 * the owner password reveals nothing about the superuser's (HMAC is one-way).
 * It changes when the superuser's does. The Go sidecar derives the same value
 * (shared vectors: vectors.json).
 *
 * @param {string} superuserPassword
 */
export function deriveOwnerPassword(superuserPassword) {
	return createHmac("sha256", Buffer.from(superuserPassword, "utf8"))
		.update(OWNER_ROLE)
		.digest("hex");
}

/**
 * The password of a connection URL as the database sees it, or null when the
 * URL has none or does not parse.
 *
 * @param {string} connectionString
 * @returns {string | null}
 */
export function urlPassword(connectionString) {
	try {
		const raw = new URL(connectionString).password;
		if (!raw) return null;
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

/**
 * The URL with the owner's name and password in place of the superuser's;
 * host, database and query string stay.
 *
 * @param {string} connectionString
 * @param {string} ownerPassword
 */
export function ownerUrl(connectionString, ownerPassword) {
	const url = new URL(connectionString);
	url.username = OWNER_ROLE;
	url.password = ownerPassword;
	return url.toString();
}

/**
 * A SCRAM-SHA-256 verifier for ALTER ROLE ... PASSWORD, so the plain password
 * never reaches the server (or its logs). A random salt and 4096 iterations,
 * Postgres's own default. Only for printable ASCII, where SASLprep (which
 * Postgres applies) changes nothing.
 *
 * @param {string} password
 * @param {Buffer} [salt]
 * @param {number} [iterations]
 */
export function scramVerifier(
	password,
	salt = randomBytes(16),
	iterations = 4096,
) {
	if (!/^[\x21-\x7e]+$/.test(password)) {
		throw new Error(
			"The owner password must be printable ASCII without spaces",
		);
	}
	if (iterations < 4096) throw new Error("Use at least 4096 iterations");
	const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
	const clientKey = createHmac("sha256", salted).update("Client Key").digest();
	const storedKey = createHash("sha256").update(clientKey).digest();
	const serverKey = createHmac("sha256", salted).update("Server Key").digest();
	return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** SQLSTATEs a racing bootstrap on a shared cluster can raise; worth a retry. */
const RETRYABLE = new Set(["XX000", "42710", "23505", "40001", "40P01"]);

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {() => Promise<T>} work
 * @param {number} attempts
 * @returns {Promise<T>}
 * @template T
 */
async function retrying(work, attempts = 6) {
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
async function connect(connectionString) {
	const client = new pg.Client({
		connectionString,
		connectionTimeoutMillis: 10_000,
	});
	await client.connect();
	await client.query("SET search_path = pg_catalog, pg_temp");
	return client;
}

/** @param {string} name */
const bootstrapFile = (name) => readFileSync(join(BOOTSTRAP_DIR, name), "utf8");

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
 * @param {pg.Client} client a superuser connection
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
 * @typedef {{ status: "switched", ownerUrl: string, changedObjects: number }
 *   | { status: "unchanged", reason: "not-superuser" | "no-password" | "unreadable-password" }} BootstrapResult
 */

/** The database setting a superuser sets while a new install is being set up. */
const FRESH_MARKER = "retrospend.fresh_install";

/**
 * Whether this database is a brand-new install the owner has had no chance to
 * plant anything in (owner-fresh.sql), from the catalogs only.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }} client
 * @returns {Promise<boolean>}
 */
export async function neverHandedOver(client) {
	const { rows } = await client.query(bootstrapFile("owner-fresh.sql"));
	return rows[0]?.fresh === true;
}

/**
 * The quoted name of the database `client` is connected to.
 *
 * @param {pg.Client} client
 */
async function databaseIdentifier(client) {
	const { rows } = await client.query(
		"SELECT pg_catalog.quote_ident(pg_catalog.current_database()) AS name",
	);
	return String(rows[0]?.name);
}

/**
 * Takes CREATE on the database away from the owner. If the connection died
 * while the migrations ran, it signs in again to do it.
 *
 * @param {pg.Client} admin
 * @param {string} databaseUrl
 * @param {string} database the quoted database name
 */
async function revokeDatabaseCreate(admin, databaseUrl, database) {
	const statement = `REVOKE CREATE ON DATABASE ${database} FROM ${OWNER_ROLE}`;
	try {
		await admin.query(statement);
	} catch {
		const again = await connect(databaseUrl);
		try {
			await again.query(statement);
		} finally {
			await again.end().catch(() => undefined);
		}
	}
}

/**
 * Runs the whole bootstrap against `databaseUrl` when it is a superuser URL
 * with a password. Anything else is left exactly as it is: a managed Postgres
 * or a setup done by hand (not a superuser) keeps working, and a superuser
 * URL without a password (trust authentication) cannot get a derived secret
 * that is not guessable, so it keeps today's behavior with a loud warning
 * unless DATABASE_OWNER_PASSWORD gives the owner a secret of its own.
 *
 * With `whileOwnerMayCreate`, the callback runs with the owner's URL. On a
 * brand-new install (never handed over: neverHandedOver) the owner holds CREATE
 * on the database for as long as it runs and loses it again in a `finally`, so a
 * failed callback still takes it back; the superuser connection stays open for
 * that and reads nothing the owner owns. On an upgrade or any later start the
 * owner is never given CREATE, so the callback's migrations must not need it.
 *
 * @param {string} databaseUrl
 * @param {{ ownerPassword?: string, warn?: (message: string) => void, whileOwnerMayCreate?: (ownerUrl: string) => Promise<void> }} [options]
 * @returns {Promise<BootstrapResult>}
 */
export async function bootstrap(databaseUrl, options = {}) {
	const warn = options.warn ?? ((message) => console.error(message));
	const override = options.ownerPassword || undefined;

	const admin = await connect(databaseUrl);
	try {
		const { rows } = await admin.query(
			"SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
		);
		if (!rows[0]?.rolsuper) {
			return { status: "unchanged", reason: "not-superuser" };
		}

		const superPassword = urlPassword(databaseUrl);
		if (!override && !superPassword) {
			const hasPasswordText = (() => {
				try {
					return new URL(databaseUrl).password !== "";
				} catch {
					return false;
				}
			})();
			warn(
				hasPasswordText
					? "WARNING: the database password in DATABASE_URL is not a valid percent-encoded value, so the app keeps connecting as the superuser. Encode special characters (for example @ as %40) or set DATABASE_OWNER_PASSWORD."
					: "WARNING: DATABASE_URL names a superuser without a password, so the app keeps connecting as the superuser. Give the database user a password, or set DATABASE_OWNER_PASSWORD to a secret of your own.",
			);
			return {
				status: "unchanged",
				reason: hasPasswordText ? "unreadable-password" : "no-password",
			};
		}
		const ownerPassword = override ?? deriveOwnerPassword(superPassword ?? "");
		const url = ownerUrl(databaseUrl, ownerPassword);

		// Decided now, from the catalogs, before the owner is given anything.
		const fresh = options.whileOwnerMayCreate
			? await neverHandedOver(admin)
			: false;

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

		const database = await databaseIdentifier(admin);
		if (fresh) {
			// A start that fails halfway is retried as a new install.
			await admin.query(
				`ALTER DATABASE ${database} SET ${FRESH_MARKER} = 'on'`,
			);
		}
		const changedObjects = await handover(admin);
		if (options.whileOwnerMayCreate) {
			if (!fresh) {
				// An upgrade or a later start: no CREATE. Whatever the owner has
				// planted in its own objects (a view, a trigger) runs during the
				// migrations, and with CREATE it could install a trusted
				// extension whose script runs as the superuser.
				await options.whileOwnerMayCreate(url);
			} else {
				await admin.query(
					`GRANT CREATE ON DATABASE ${database} TO ${OWNER_ROLE}`,
				);
				try {
					await options.whileOwnerMayCreate(url);
				} finally {
					await revokeDatabaseCreate(admin, databaseUrl, database);
				}
				await admin.query(`ALTER DATABASE ${database} RESET ${FRESH_MARKER}`);
			}
		}
		return { status: "switched", ownerUrl: url, changedObjects };
	} finally {
		await admin.end().catch(() => undefined);
	}
}

/**
 * The environment the app gets: only names the app reads, with DATABASE_URL
 * set to the owner's URL. The superuser's URL, POSTGRES_PASSWORD and anything
 * else the container was given for the entrypoint never reach the app, so code
 * that runs in the app cannot read the superuser's credentials from its own
 * environment or /proc/self/environ.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} databaseUrl the URL the app should use
 * @returns {{ env: Record<string, string>, dropped: string[] }}
 */
export function buildAppEnv(env, databaseUrl) {
	/** @type {Record<string, string>} */
	const kept = {};
	/** @type {string[]} */
	const dropped = [];
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (isAppEnvName(name)) kept[name] = value;
		else if (!QUIET_DROPS.has(name)) dropped.push(name);
	}
	kept.DATABASE_URL = databaseUrl;
	return { env: kept, dropped: dropped.sort() };
}

/** @param {string} value */
export function shellQuote(value) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A line for the entrypoint to eval: it puts `env -i NAME=value ...` in front
 * of the positional parameters (the command to run), so `exec "$@"` starts
 * the app with exactly this environment.
 *
 * @param {Record<string, string>} env
 */
export function shellExecPrefix(env) {
	const assignments = Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => shellQuote(`${name}=${value}`));
	return `set -- env -i ${assignments.join(" ")} "$@"`;
}

/** What the migration and grants tools may see: no secret of the app's, none of the superuser's. */
const TOOL_ENV_NAMES = [
	"PATH",
	"HOME",
	"USER",
	"TMPDIR",
	"TZ",
	"LANG",
	"LC_ALL",
	"LD_LIBRARY_PATH",
	"NODE_OPTIONS",
	"NODE_EXTRA_CA_CERTS",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
];
const TOOL_ENV_PREFIXES = ["PRISMA_", "LC_"];

/**
 * The environment of `prisma migrate deploy` and the grants file: system
 * variables, Prisma's own settings, and DATABASE_URL set to `databaseUrl` (the
 * owner's). POSTGRES_PASSWORD, the superuser's URL and the app's secrets are
 * not in it.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} databaseUrl
 * @returns {Record<string, string>}
 */
export function buildToolEnv(env, databaseUrl) {
	/** @type {Record<string, string>} */
	const kept = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (
			TOOL_ENV_NAMES.includes(name) ||
			TOOL_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
		) {
			kept[name] = value;
		}
	}
	kept.DATABASE_URL = databaseUrl;
	return kept;
}

/**
 * @typedef {(args: string[]) => Promise<{ status: number | null, output: string }>} PrismaRunner
 */

/**
 * Runs the Prisma CLI in `root` with the tool environment. Its output goes to
 * stderr (stdout is for the owner's URL) and is returned too.
 *
 * @param {string} root
 * @param {string} databaseUrl
 * @param {Record<string, string | undefined>} [env]
 * @returns {PrismaRunner}
 */
export function prismaRunner(root, databaseUrl, env = process.env) {
	return (args) =>
		new Promise((resolve) => {
			const child = spawn(join(root, "node_modules", ".bin", "prisma"), args, {
				cwd: root,
				env: /** @type {NodeJS.ProcessEnv} */ (buildToolEnv(env, databaseUrl)),
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			/** @param {Buffer} chunk */
			const take = (chunk) => {
				output += chunk.toString();
				process.stderr.write(chunk);
			};
			child.stdout.on("data", take);
			child.stderr.on("data", take);
			child.on("error", (error) => {
				output += String(error);
				resolve({ status: null, output });
			});
			child.on("close", (status) => resolve({ status, output }));
		});
}

/**
 * `prisma migrate deploy`, with the recovery the entrypoint always had: a
 * failed migration (P3009) is marked rolled back and tried again, a database
 * that has tables but no migration table (P3005) is baselined at the first
 * migration and migrated, and anything else stops the start.
 *
 * @param {string} databaseUrl the URL to migrate with
 * @param {{ root?: string, run?: PrismaRunner, log?: (message: string) => void }} [options]
 */
export async function migrateWithRecovery(databaseUrl, options = {}) {
	const root = options.root ?? PROJECT_ROOT;
	const run = options.run ?? prismaRunner(root, databaseUrl);
	const log = options.log ?? ((message) => console.error(message));
	/** @param {string[]} args */
	const mustRun = async (args) => {
		const done = await run(args);
		if (done.status !== 0) {
			throw new Error(`prisma ${args.slice(0, 2).join(" ")} failed`);
		}
	};

	const first = await run(["migrate", "deploy"]);
	if (first.status === 0) {
		log("Database migrations applied successfully!");
		return;
	}

	if (first.output.includes("P3009")) {
		const failed = /The `([^`]+)` migration/.exec(first.output)?.[1];
		if (!failed) {
			throw new Error(
				"Migration failed (P3009) but could not parse migration name.",
			);
		}
		log(`Found failed migration: ${failed}. Rolling back and retrying...`);
		await mustRun(["migrate", "resolve", "--rolled-back", failed]);
		await mustRun(["migrate", "deploy"]);
		log("Database migrations applied successfully after rollback!");
		return;
	}

	if (first.output.includes("P3005")) {
		log(
			"Database schema is not empty (Error P3005). Attempting to baseline...",
		);
		const baseline = readdirSync(join(root, "prisma", "migrations"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()[0];
		if (!baseline) {
			throw new Error("No migration files found in prisma/migrations.");
		}
		log(`Marking baseline migration as applied: ${baseline}`);
		const resolved = await run(["migrate", "resolve", "--applied", baseline]);
		if (resolved.status !== 0) {
			throw new Error("Failed to resolve baseline migration.");
		}
		log("Baseline migration resolved. Retrying migrations...");
		await mustRun(["migrate", "deploy"]);
		log("Database migrations applied successfully after baseline!");
		return;
	}

	throw new Error("Migration failed. Please check the logs above.");
}

/**
 * Gives the app role its privileges (prisma/grants/app-role.sql), as the URL's
 * user.
 *
 * @param {string} databaseUrl
 * @param {{ root?: string, run?: PrismaRunner }} [options]
 */
export async function applyGrants(databaseUrl, options = {}) {
	const root = options.root ?? PROJECT_ROOT;
	const run = options.run ?? prismaRunner(root, databaseUrl);
	const done = await run([
		"db",
		"execute",
		"--file",
		"prisma/grants/app-role.sql",
	]);
	if (done.status !== 0) throw new Error("Applying the grants file failed.");
}

/**
 * A start: the bootstrap, the migrations as the owner, and the grants file as
 * the owner. The owner holds CREATE on the database for the migrations and not
 * a moment longer. A URL the bootstrap leaves alone migrates as it is.
 *
 * @param {string} databaseUrl
 * @param {{ ownerPassword?: string, warn?: (message: string) => void, log?: (message: string) => void, root?: string, grants?: boolean }} [options]
 * @returns {Promise<{ url: string, result: BootstrapResult }>} the URL the rest of the start should use
 */
export async function prepare(databaseUrl, options = {}) {
	const log = options.log ?? ((message) => console.error(message));
	const root = options.root ?? PROJECT_ROOT;
	log("Applying database migrations...");
	const migrate = (/** @type {string} */ url) =>
		migrateWithRecovery(url, { root, log });
	const result = await bootstrap(databaseUrl, {
		ownerPassword: options.ownerPassword,
		warn: options.warn,
		whileOwnerMayCreate: migrate,
	});
	let url = databaseUrl;
	if (result.status === "switched") {
		url = result.ownerUrl;
	} else {
		await migrate(databaseUrl);
	}
	if (options.grants) {
		log("Applying database grants...");
		await applyGrants(url, { root });
	}
	return { url, result };
}
