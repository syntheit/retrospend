// Command line for scripts/db-owner/index.mjs.
//
//   bootstrap   Reads DATABASE_URL (and DATABASE_OWNER_PASSWORD). With a
//               superuser URL it creates the owner role, hands it the objects
//               and prints the owner's URL on stdout, and nothing else there.
//               With any other URL it prints nothing and the caller keeps its
//               URL. Messages go to stderr. docker-entrypoint.sh uses this.
//   app-exec    Prints a shell line that puts `env -i NAME=value ...` in front
//               of the positional parameters, for the entrypoint's final exec.
//   run         For local development (pnpm dev, pnpm dev:test): bootstraps,
//               migrates as the owner, optionally applies the grants file
//               (--grants), then runs the rest of the command line with the
//               owner's URL as DATABASE_URL.
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { bootstrap, buildAppEnv, shellExecPrefix } from "./index.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>} the URL later steps should use
 */
async function bootstrapUrl(env) {
	const url = env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is not set");
	const result = await bootstrap(url, {
		ownerPassword: env.DATABASE_OWNER_PASSWORD,
	});
	if (result.status === "switched") {
		console.error(
			`Database: connecting as retrospend_owner (${result.changedObjects} objects handed over)`,
		);
		return result.ownerUrl;
	}
	console.error(
		`Database: connecting with DATABASE_URL as given (${result.reason})`,
	);
	return url;
}

async function main() {
	const [command, ...rest] = process.argv.slice(2);

	if (command === "bootstrap") {
		const url = await bootstrapUrl(process.env);
		// Print only a URL that differs: nothing means "keep yours".
		if (url !== process.env.DATABASE_URL) process.stdout.write(`${url}\n`);
		return;
	}

	if (command === "app-exec") {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) throw new Error("DATABASE_URL is not set");
		const { env, dropped } = buildAppEnv(process.env, databaseUrl);
		if (dropped.length > 0) {
			console.error(
				`Not passed to the app (names only; add one to APP_ENV_NAMES in scripts/db-owner/index.mjs if the app reads it): ${dropped.join(", ")}`,
			);
		}
		process.stdout.write(`${shellExecPrefix(env)}\n`);
		return;
	}

	if (command === "run") {
		const split = rest.indexOf("--");
		const flags = split === -1 ? [] : rest.slice(0, split);
		const argv = split === -1 ? rest : rest.slice(split + 1);
		const [program, ...args] = argv;
		if (!program) throw new Error("Usage: cli.mjs run [--grants] -- <command>");

		// Next and Prisma read these files themselves; this script needs the
		// URL first. Files never override what the shell already set.
		dotenv.config({ path: [".env.local", ".env"], quiet: true });
		const url = await bootstrapUrl(process.env);
		const env = { ...process.env, DATABASE_URL: url };

		const prisma = join(repoRoot, "node_modules", ".bin", "prisma");
		const steps = [["migrate", "deploy"]];
		if (flags.includes("--grants")) {
			steps.push(["db", "execute", "--file", "prisma/grants/app-role.sql"]);
		}
		for (const step of steps) {
			const done = spawnSync(prisma, step, {
				env,
				stdio: "inherit",
				cwd: repoRoot,
			});
			if (done.status !== 0) process.exit(done.status ?? 1);
		}

		const child = spawn(program, args, {
			env,
			stdio: "inherit",
			cwd: repoRoot,
		});
		for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
			process.on(signal, () => child.kill(signal));
		}
		child.on("exit", (code, signal) => {
			process.exit(code ?? (signal ? 1 : 0));
		});
		return;
	}

	throw new Error(
		"Usage: cli.mjs bootstrap | app-exec | run [--grants] -- <command>",
	);
}

main().catch((error) => {
	console.error(`db-owner: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
