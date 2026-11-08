// The migrations and the grants file, run with the Prisma CLI in a sanitized
// environment, and a whole start (prepare).
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { bootstrap } from "./bootstrap.mjs";
import { PROJECT_ROOT } from "./constants.mjs";
import { buildToolEnv } from "./env.mjs";

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

const NO_CREATE_HINT =
	"Migration failed: the migration role has no CREATE on this database, which only a brand-new, empty database gets. If this install never finished its first start, drop the database and create it again empty.";

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
		const retry = await run(["migrate", "deploy"]);
		if (retry.status !== 0) {
			throw new Error(
				retry.output.includes("permission denied for database")
					? NO_CREATE_HINT
					: "prisma migrate deploy failed",
			);
		}
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

	throw new Error(
		first.output.includes("permission denied for database")
			? NO_CREATE_HINT
			: "Migration failed. Please check the logs above.",
	);
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
 * A start: the bootstrap, the migrations, and the grants file as the owner. A
 * brand-new install migrates as a one-shot role that holds CREATE on the
 * database for the migrations and not a moment longer; an upgrade migrates as
 * the owner. A URL the bootstrap leaves alone migrates as it is.
 *
 * @param {string} databaseUrl
 * @param {{ ownerPassword?: string, warn?: (message: string) => void, log?: (message: string) => void, root?: string, grants?: boolean }} [options]
 * @returns {Promise<{ url: string, result: import("./bootstrap.mjs").BootstrapResult }>} the URL the rest of the start should use
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
